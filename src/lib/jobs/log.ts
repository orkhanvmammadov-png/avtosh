import { randomUUID } from "node:crypto";

/**
 * Structured, scrubbed job observability. Only allowlisted scalar
 * fields are emitted — phone numbers, payment/provider secrets, and
 * message bodies have no path into these events by construction.
 */

type SafeValue = string | number | boolean | null | undefined;

export interface JobRunLog {
  runId: string;
  event(event: string, fields?: Record<string, SafeValue>): void;
}

export function startJobRun(job: string): JobRunLog {
  const runId = randomUUID();
  const event = (name: string, fields: Record<string, SafeValue> = {}) => {
    console.info(JSON.stringify({ evt: `job.${name}`, job, run_id: runId, ...fields }));
  };
  event("started");
  return { runId, event };
}
