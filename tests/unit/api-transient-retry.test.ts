import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiHandler } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/errors";
import { apiSuccess } from "@/lib/api/response";
import { isTransientConnectionError } from "@/lib/server/db/transient-error";
import { withTransientReadRetry, didTransientReadRetryFail } from "@/lib/server/db/read-retry";
import { normalizeRoute } from "@/lib/api/error-log";

// Behavior tests for the central handler (which must NEVER retry a
// request — /api/jobs/* are mutating GETs, detail GETs can count
// views, authenticated GETs touch last_seen_at in FULL mode), the
// opt-in pure-read retry wrapper, and the sanitized error log.
// NODE_ENV=test runs FULL launch mode, so every method reaches the
// handler (the READ_ONLY gate has its own suites).

// Shaped like a real postgres.js connection error: the message and
// address embed the pooler host, which must never reach a log line.
function connectionClosedError(): Error {
  return Object.assign(new Error("write CONNECTION_CLOSED db.secretref.pooler.supabase.com:5432"), {
    code: "CONNECTION_CLOSED",
    errno: "CONNECTION_CLOSED",
    address: "db.secretref.pooler.supabase.com",
    port: 5432,
  });
}

function leakyUnknownError(): Error {
  return Object.assign(
    new Error("connect failed for postgres://avtosh:secretpass@db.secretref.supabase.co:5432/postgres"),
    { cause: Object.assign(new Error("inner"), { code: "SOME_UNKNOWN" }) },
  );
}

let errorLog: ReturnType<typeof vi.spyOn>;
let warnLog: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  warnLog = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function loggedLines(spy: ReturnType<typeof vi.spyOn>): string[] {
  return (spy.mock.calls as unknown[][]).map((call) => String(call[0]));
}

describe("createApiHandler never retries a request", () => {
  it("an ordinary (unflagged) GET is attempted exactly once even for a transient failure", async () => {
    let calls = 0;
    const route = createApiHandler(async () => {
      calls += 1; // stands in for ANY handler side effect (job run, view count, session touch)
      throw connectionClosedError();
    });
    const response = await route(new Request("http://localhost/api/jobs/expire-listings"));
    expect(response.status).toBe(500);
    expect(calls).toBe(1);
    const logged = loggedLines(errorLog).map((l) => JSON.parse(l));
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      event: "api_unexpected_error",
      method: "GET",
      route: "/api/jobs/expire-listings",
      error_code: "CONNECTION_CLOSED",
      transient_connection: true,
      retry: "not_attempted",
    });
    expect(warnLog).not.toHaveBeenCalled();
  });

  it("a side-effecting GET handler never duplicates its side effect on failure or success", async () => {
    for (const outcome of ["throw", "succeed"] as const) {
      let sideEffects = 0;
      const route = createApiHandler(async ({ requestId }) => {
        sideEffects += 1; // e.g. last_seen_at touch or view-count increment
        if (outcome === "throw") throw connectionClosedError();
        return apiSuccess({ ok: true }, { requestId });
      });
      await route(new Request("http://localhost/api/v1/auth/me"));
      expect(sideEffects).toBe(1);
    }
  });

  it("non-GET methods are attempted exactly once for transient failures", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      let calls = 0;
      const route = createApiHandler(async () => {
        calls += 1;
        throw connectionClosedError();
      });
      const response = await route(new Request("http://localhost/api/v1/me/listings", { method }));
      expect(response.status).toBe(500);
      expect(calls).toBe(1);
    }
  });

  it("expected ApiErrors produce no unexpected-error log and keep their envelope", async () => {
    const route = createApiHandler(async () => {
      throw new ApiError("VALIDATION_ERROR", "Invalid query parameters.");
    });
    const response = await route(new Request("http://localhost/api/v1/catalog/brands"));
    expect(response.status).toBe(400);
    expect(errorLog).not.toHaveBeenCalled();
    expect(warnLog).not.toHaveBeenCalled();
  });
});

describe("withTransientReadRetry (explicit opt-in pure reads)", () => {
  it("retries exactly once and recovers, logging a sanitized recovery event", async () => {
    let calls = 0;
    const result = await withTransientReadRetry("catalog.getCities", async () => {
      calls += 1;
      if (calls === 1) throw connectionClosedError();
      return ["ok"];
    });
    expect(result).toEqual(["ok"]);
    expect(calls).toBe(2);
    const recovered = loggedLines(warnLog).map((l) => JSON.parse(l));
    expect(recovered).toHaveLength(1);
    expect(recovered[0]).toMatchObject({
      event: "api_transient_read_recovered",
      operation: "catalog.getCities",
      error_code: "CONNECTION_CLOSED",
      retry: "succeeded",
    });
  });

  it("a persistent transient failure stops after exactly two attempts and is marked for the error log", async () => {
    let calls = 0;
    await expect(
      withTransientReadRetry("catalog.getCities", async () => {
        calls += 1;
        throw connectionClosedError();
      }),
    ).rejects.toMatchObject({ code: "CONNECTION_CLOSED" });
    expect(calls).toBe(2);
  });

  it("a persistent opted-in failure surfaces through the handler as a generic 500 with retry: failed", async () => {
    const route = createApiHandler(async () => {
      return apiSuccess(
        await withTransientReadRetry("catalog.getCities", async () => {
          throw connectionClosedError();
        }),
      );
    });
    const response = await route(new Request("http://localhost/api/v1/catalog/cities"));
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: Record<string, unknown> };
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).toBe("An unexpected error occurred.");
    const logged = loggedLines(errorLog).map((l) => JSON.parse(l));
    expect(logged[0]).toMatchObject({ retry: "failed", transient_connection: true });
    expect(logged[0].request_id).toBe(body.error.request_id);
  });

  it("non-transient errors are never retried and never marked", async () => {
    let calls = 0;
    const error = leakyUnknownError();
    await expect(
      withTransientReadRetry("catalog.getCities", async () => {
        calls += 1;
        throw error;
      }),
    ).rejects.toBe(error);
    expect(calls).toBe(1);
    expect(didTransientReadRetryFail(error)).toBe(false);
  });

  it("a SQL/server error (PostgresError) is never treated as transient", () => {
    const sqlError = Object.assign(new Error("relation does not exist"), {
      name: "PostgresError",
      code: "42P01",
    });
    expect(isTransientConnectionError(sqlError)).toBe(false);
    // Even a connection-flavored SQLSTATE stays non-transient.
    const connFlavored = Object.assign(new Error("x"), { name: "PostgresError", code: "08006" });
    expect(isTransientConnectionError(connFlavored)).toBe(false);
  });

  it("classifies transport codes anywhere in the cause chain", () => {
    const wrapped = new Error("query failed", {
      cause: Object.assign(new Error("socket"), { code: "ECONNRESET" }),
    });
    expect(isTransientConnectionError(wrapped)).toBe(true);
    expect(isTransientConnectionError(new Error("plain"))).toBe(false);
    expect(isTransientConnectionError(new ApiError("VALIDATION_ERROR", "x"))).toBe(false);
  });
});

describe("sanitized unexpected-error log", () => {
  it("never emits messages, hosts, connection strings or credentials", async () => {
    const route = createApiHandler(async () => {
      throw leakyUnknownError();
    });
    await route(new Request("http://localhost/api/v1/catalog/cities"));
    const combined = [...loggedLines(errorLog), ...loggedLines(warnLog)].join("\n");
    expect(combined).not.toContain("postgres://");
    expect(combined).not.toContain("secretpass");
    expect(combined).not.toContain("secretref");
    expect(combined).not.toContain("supabase");
    expect(combined).not.toContain("connect failed");
    expect(combined).not.toContain("@");
  });

  it("never emits the pooler host, on failure or on recovery", async () => {
    await withTransientReadRetry("catalog.getCities", (() => {
      let calls = 0;
      return async () => {
        calls += 1;
        if (calls === 1) throw connectionClosedError();
        return "ok";
      };
    })());
    const route = createApiHandler(async () => {
      throw connectionClosedError();
    });
    await route(new Request("http://localhost/api/v1/catalog/cities"));
    const combined = [...loggedLines(errorLog), ...loggedLines(warnLog)].join("\n");
    expect(combined).toContain("CONNECTION_CLOSED");
    expect(combined).not.toContain("secretref");
    expect(combined).not.toContain("supabase");
    expect(combined).not.toContain("5432");
  });

  it("normalizes dynamic route params out of the logged route", async () => {
    const route = createApiHandler(async () => {
      throw leakyUnknownError();
    });
    await route(new Request("http://localhost/api/v1/listings/AB12CD34/contact", { method: "GET" }), {
      params: Promise.resolve({ publicId: "AB12CD34" }),
    });
    const logged = loggedLines(errorLog).map((l) => JSON.parse(l));
    expect(logged[0].route).toBe("/api/v1/listings/:publicId/contact");
    expect(JSON.stringify(logged)).not.toContain("AB12CD34");
  });

  it("normalizeRoute replaces only param-valued segments", () => {
    expect(normalizeRoute("/api/v1/listings/xyz/contact", { publicId: "xyz" })).toBe(
      "/api/v1/listings/:publicId/contact",
    );
    expect(normalizeRoute("/api/v1/catalog/cities", {})).toBe("/api/v1/catalog/cities");
  });
});

describe("READ_ONLY behavior is unchanged", () => {
  it("non-read methods still fail closed with 503 and no unexpected-error log", async () => {
    vi.stubEnv("LAUNCH_MODE", "READ_ONLY");
    try {
      let calls = 0;
      const route = createApiHandler(async () => {
        calls += 1;
        return apiSuccess({ ok: true });
      });
      const response = await route(
        new Request("http://localhost/api/v1/listings/x/report", { method: "POST" }),
      );
      expect(response.status).toBe(503);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code).toBe("SERVICE_READ_ONLY");
      expect(calls).toBe(0);
      expect(errorLog).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
