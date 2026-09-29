/**
 * Classification of transient connection/transport failures.
 *
 * Serverless instances are frozen between invocations and the
 * database pooler drops idle clients, so a pooled TCP connection can
 * be silently severed while the instance sleeps. postgres.js rejects
 * the next query on such a socket immediately with a connection
 * error (code CONNECTION_CLOSED etc.) and EVICTS that connection
 * from its pool — a subsequent query acquires a fresh connection.
 *
 * Only errors matching this closed allowlist of connection/transport
 * codes are transient. Server-sent SQL errors (postgres.js
 * PostgresError, SQLSTATE codes), validation errors, ApiErrors and
 * unknown errors are never classified transient.
 */

const TRANSIENT_CONNECTION_CODES = new Set([
  // postgres.js connection lifecycle errors
  "CONNECTION_CLOSED",
  "CONNECTION_ENDED",
  "CONNECTION_DESTROYED",
  "CONNECT_TIMEOUT",
  // Node socket/DNS transport errors
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "ETIMEDOUT",
  "EAI_AGAIN",
]);

const MAX_CAUSE_DEPTH = 5;

function codeOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/** Walks `error` and its `cause` chain (bounded depth). */
export function errorChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current !== undefined && current !== null; depth += 1) {
    chain.push(current);
    current = (current as { cause?: unknown }).cause;
  }
  return chain;
}

export function isTransientConnectionError(error: unknown): boolean {
  return errorChain(error).some((entry) => {
    // A PostgresError is a server response over a WORKING connection
    // (SQLSTATE) — never transient, whatever its code says.
    if ((entry as { name?: unknown })?.name === "PostgresError") return false;
    const code = codeOf(entry);
    return code !== undefined && TRANSIENT_CONNECTION_CODES.has(code);
  });
}
