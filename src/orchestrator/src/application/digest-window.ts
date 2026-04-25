/**
 * Normalizes shorthand duration strings into Postgres interval-compatible literals.
 *
 * Accepted formats: `Nw` (weeks), `Nd` (days), `Nh` (hours).
 * Any unrecognized input falls back to "7 days" as a safe default.
 *
 * @param value - Raw duration input from API payload.
 * @returns Postgres-compatible interval string.
 */
export function normalizeDigestSince(value: unknown): string {
  if (typeof value !== "string") {
    return "7 days";
  }

  const normalized = value.trim().toLowerCase();
  const weekMatch = normalized.match(/^(\d{1,2})w$/);
  if (weekMatch) {
    return `${weekMatch[1]} weeks`;
  }

  const dayMatch = normalized.match(/^(\d{1,3})d$/);
  if (dayMatch) {
    return `${dayMatch[1]} days`;
  }

  const hourMatch = normalized.match(/^(\d{1,3})h$/);
  if (hourMatch) {
    return `${hourMatch[1]} hours`;
  }

  return "7 days";
}
