/**
 * Filter normalization for POST /v1/memory/recall payloads.
 *
 * Extracts and sanitizes all filter fields from the raw request body into a
 * typed object consumed by the Postgres recall query. Centralizing this
 * normalization keeps the main handler focused on request/response lifecycle
 * and makes the field list easy to audit independently.
 */

import { sanitizeTags, sanitizeText } from "../../domain/memory-validation.js";

/**
 * Normalized recall filters derived from raw request body fields.
 *
 * All string fields are sanitized; absent fields are represented as `null`
 * or empty arrays so the Postgres layer can apply optional WHERE clauses
 * without additional null checks in the handler.
 */
export interface RecallFilters {
  scope: string | null;
  repo: string | null;
  project: string | null;
  language: string | null;
  type: string | null;
  tags: string[];
  frameworks: string[];
  include_expired: boolean;
  include_forgotten: boolean;
  include_redacted: boolean;
}

/**
 * Extracts and sanitizes all recall filter fields from a raw JSON body.
 *
 * Accepts both snake_case and camelCase field names so callers are not
 * forced into a single naming convention. Boolean flags require the exact
 * value `true`; any other truthy value is treated as absent to prevent
 * accidental exposure of soft-deleted records.
 *
 * @param payload - Parsed JSON body from the request.
 * @returns Normalized filter object ready for the DB query layer.
 */
export function normalizeRecallFilters(
  payload: Record<string, unknown>,
): RecallFilters {
  return {
    scope: sanitizeText(payload["scope"], 16),
    repo: sanitizeText(payload["repo"], 256),
    project: sanitizeText(payload["project"], 128),
    language: sanitizeText(payload["language"], 64),
    type: sanitizeText(payload["type"], 32),
    tags: sanitizeTags(payload["tags"]),
    frameworks: Array.isArray(payload["frameworks"])
      ? (payload["frameworks"] as unknown[])
          .filter((v): v is string => typeof v === "string")
          .map((v) => v.trim().toLowerCase())
          .slice(0, 8)
      : [],
    include_expired:
      payload["include_expired"] === true || payload["includeExpired"] === true,
    include_forgotten:
      payload["include_forgotten"] === true ||
      payload["includeForgotten"] === true,
    include_redacted:
      payload["include_redacted"] === true ||
      payload["includeRedacted"] === true,
  };
}
