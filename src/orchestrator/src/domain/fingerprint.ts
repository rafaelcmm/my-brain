import { createHash } from "node:crypto";

/**
 * Generates a stable fingerprint for semantically equivalent memory content so dedup logic can bucket candidates deterministically.
 *
 * @param content - Memory content before persistence or backfill normalization.
 * @returns SHA1 fingerprint over trimmed, lowercased, whitespace-collapsed content.
 */
export function contentFingerprint(content: string): string {
  const normalized = content.trim().toLowerCase().replace(/\s+/g, " ");
  return createHash("sha1").update(normalized).digest("hex");
}

/**
 * Coerces embedding payloads from database rows or HTTP payloads into a usable numeric vector.
 *
 * @param value - Candidate vector payload from JSON, arrays, or serialized storage.
 * @returns Numeric vector when at least one finite coordinate survives coercion, otherwise null.
 */
export function asVector(value: unknown): number[] | null {
  if (Array.isArray(value)) {
    const converted = value
      .map((entry) => Number(entry))
      .filter((entry) => Number.isFinite(entry));
    return converted.length > 0 ? converted : null;
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return asVector(parsed);
    } catch {
      return null;
    }
  }

  return null;
}
