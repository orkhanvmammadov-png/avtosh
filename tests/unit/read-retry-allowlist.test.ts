import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The transient-read retry is opt-in ONLY. This guard pins the exact
// allowlist: if any new module starts importing the wrapper — a jobs
// route, the marketplace service (view counter), auth/session code,
// payment code, anything — this test fails and forces an explicit
// review of that operation's purity.

const SRC = path.join(process.cwd(), "src");

function filesImporting(needle: string): string[] {
  try {
    const out = execFileSync("grep", ["-rl", needle, SRC], { encoding: "utf8" });
    return out
      .split("\n")
      .filter(Boolean)
      .map((f) => path.relative(process.cwd(), f))
      .sort();
  } catch {
    return [];
  }
}

describe("transient-read retry allowlist", () => {
  it("withTransientReadRetry is used only by the catalog service", () => {
    const importers = filesImporting("withTransientReadRetry").filter(
      (f) => f !== "src/lib/server/db/read-retry.ts",
    );
    expect(importers).toEqual(["src/services/catalog.ts"]);
  });

  it("the handler consumes only the failure marker, never the retry itself", () => {
    const handler = readFileSync(path.join(SRC, "lib/api/handler.ts"), "utf8");
    expect(handler).toContain("didTransientReadRetryFail");
    expect(handler).not.toContain("withTransientReadRetry");
    expect(handler).not.toContain("isTransientConnectionError");
  });

  it("known side-effecting GET modules never import the retry wrapper", () => {
    const denylist = [
      "src/app/api/jobs/expire-listings/route.ts",
      "src/app/api/jobs/cleanup-images/route.ts",
      "src/app/api/jobs/promotion-housekeeping/route.ts",
      "src/app/api/jobs/reconcile-payments/route.ts",
      "src/app/api/jobs/send-reminders/route.ts",
      "src/services/marketplace.ts", // view counter
      "src/auth/current-user.ts", // session last_seen_at touch
      "src/services/payment-checkout.ts", // provider callbacks/fulfillment
      "src/lib/jobs/cron-auth.ts",
    ];
    for (const file of denylist) {
      const source = readFileSync(path.join(process.cwd(), file), "utf8");
      expect(source, file).not.toContain("withTransientReadRetry");
      expect(source, file).not.toContain("read-retry");
    }
  });
});
