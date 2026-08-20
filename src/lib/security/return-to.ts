/**
 * return_to open-redirect protection. Only internal application paths
 * survive; everything else — absolute URLs, scheme-relative //host,
 * backslash tricks, schemes, control characters, or percent-encoded
 * variants of any of those — is rejected by returning null (callers
 * safely ignore an invalid value; it is never an error the user needs).
 */

const MAX_LENGTH = 512;

const CONTROL_OR_SPACE = /[\u0000-\u001f\u007f ]/u;

function isSafeInternalPath(path: string): boolean {
  if (!path.startsWith("/")) {
    return false;
  }
  // Scheme-relative (//host) and backslash variants (/\host, \ anywhere).
  if (path.startsWith("//") || path.includes("\\")) {
    return false;
  }
  if (CONTROL_OR_SPACE.test(path)) {
    return false;
  }
  // Embedded absolute URLs: "://" never appears in real app routes —
  // reject conservatively.
  if (path.includes("://")) {
    return false;
  }
  return true;
}

export function sanitizeReturnTo(
  value: string | null | undefined,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (value.length === 0 || value.length > MAX_LENGTH) {
    return null;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null; // malformed percent-encoding
  }
  // Both the raw and the decoded form must be safe, so encoded
  // bypasses (%2F%2Fevil.example, %5C, %3A%2F%2F) are caught.
  if (!isSafeInternalPath(value) || !isSafeInternalPath(decoded)) {
    return null;
  }
  return value;
}
