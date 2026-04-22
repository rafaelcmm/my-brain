import {
  MEMORY_SCOPES,
  MEMORY_TYPES,
  MEMORY_VISIBILITY,
  type MemoryEnvelope,
  type MemoryValidationResult,
} from "./types.js";

/**
 * Normalizes text input by trimming whitespace and capping length before storage or filtering logic consumes it.
 *
 * @param value - Candidate user-provided text value.
 * @param maxLength - Hard upper bound enforced by the storage and API contract.
 * @returns Sanitized text or null when the value is absent, non-string, or effectively empty.
 */
export function sanitizeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  return normalized.slice(0, maxLength);
}

/**
 * Normalizes tag arrays so noisy or malformed metadata cannot destabilize filtering and ranking.
 *
 * @param value - Candidate tags payload from an API request.
 * @returns Unique lowercase tags capped to the first five valid entries.
 */
export function sanitizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const unique = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }

    const tag = item.trim().toLowerCase();
    if (!/^[a-z0-9-]{2,32}$/.test(tag)) {
      continue;
    }

    unique.add(tag);
    if (unique.size >= 5) {
      break;
    }
  }

  return Array.from(unique);
}

/**
 * Validates memory write envelopes once so every write endpoint enforces identical content, scope, and metadata rules.
 *
 * @param payload - Raw request payload received by a write-oriented endpoint.
 * @returns Validation status plus a normalized envelope when the payload satisfies the contract.
 */
export function validateMemoryEnvelope(
  payload: unknown,
): MemoryValidationResult {
  const errors: string[] = [];

  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    return { valid: false, errors: ["payload must be an object"] };
  }

  const body = payload as Record<string, unknown>;
  const content = sanitizeText(body.content, 8192);
  if (!content) {
    errors.push("content must be a non-empty string");
  }

  const type = sanitizeText(body.type, 32)?.toLowerCase();
  if (!type || !MEMORY_TYPES.has(type)) {
    errors.push(
      "type must be one of: decision, fix, convention, gotcha, tradeoff, pattern, reference",
    );
  }

  const scope = sanitizeText(body.scope, 16)?.toLowerCase();
  if (!scope || !MEMORY_SCOPES.has(scope)) {
    errors.push("scope must be one of: repo, project, global");
  }

  const metadataRaw =
    typeof body.metadata === "object" &&
    body.metadata !== null &&
    !Array.isArray(body.metadata)
      ? (body.metadata as Record<string, unknown>)
      : {};

  const confidence = metadataRaw.confidence;
  if (
    confidence !== undefined &&
    (typeof confidence !== "number" ||
      Number.isNaN(confidence) ||
      confidence < 0 ||
      confidence > 1)
  ) {
    errors.push("metadata.confidence must be a number between 0 and 1");
  }

  const visibility = sanitizeText(metadataRaw.visibility, 16)?.toLowerCase();
  if (visibility && !MEMORY_VISIBILITY.has(visibility)) {
    errors.push("metadata.visibility must be one of: private, team, public");
  }

  const tags = sanitizeTags(metadataRaw.tags);
  const frameworks = Array.isArray(metadataRaw.frameworks)
    ? metadataRaw.frameworks
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim().toLowerCase())
        .filter((value) => value.length >= 2 && value.length <= 32)
        .slice(0, 8)
    : [];

  if (errors.length > 0 || !content || !type || !scope) {
    return { valid: false, errors };
  }

  const envelope: MemoryEnvelope = {
    content,
    type,
    scope,
    metadata: {
      repo: sanitizeText(metadataRaw.repo, 256),
      repo_name: sanitizeText(metadataRaw.repo_name, 128),
      project: sanitizeText(metadataRaw.project, 128),
      language: sanitizeText(metadataRaw.language, 64),
      frameworks,
      path: sanitizeText(metadataRaw.path, 512),
      symbol: sanitizeText(metadataRaw.symbol, 256),
      tags,
      source: sanitizeText(metadataRaw.source, 256),
      author: sanitizeText(metadataRaw.author, 256),
      agent: sanitizeText(metadataRaw.agent, 128),
      created_at: sanitizeText(metadataRaw.created_at, 64),
      expires_at: sanitizeText(metadataRaw.expires_at, 64),
      confidence: typeof confidence === "number" ? confidence : null,
      visibility: (visibility ??
        "private") as MemoryEnvelope["metadata"]["visibility"],
    },
  };

  return {
    valid: true,
    errors: [],
    envelope,
  };
}
