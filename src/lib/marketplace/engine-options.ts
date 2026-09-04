/**
 * Phase 4.17O.2 — engine-displacement option sequence for the search
 * filter dropdowns (Mühərrikin həcmi, sm³). Presentation range only:
 * the listing field itself keeps its broader accepted validation
 * (0–100000 in validators/listings).
 *
 * Owner-approved sequence (79 unique values):
 *   0 → 6500        step 100
 *   after 6500 → 10000  step 500
 *   after 10000 → 16000 step 1000
 * Boundary values 6500 and 10000 each appear exactly once.
 * Literal 0 is a real selectable value — the neutral "no filter"
 * choice is the UI's empty option, never 0.
 */
export function engineCcOptions(): number[] {
  const values: number[] = [];
  for (let v = 0; v <= 6500; v += 100) values.push(v);
  for (let v = 7000; v <= 10_000; v += 500) values.push(v);
  for (let v = 11_000; v <= 16_000; v += 1000) values.push(v);
  return values;
}
