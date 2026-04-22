import { FULL_MODE } from "../domain/types.js";

/**
 * Parses boolean-like environment values while keeping malformed inputs on an explicit fallback.
 *
 * @param value - Raw environment value.
 * @param fallback - Boolean used when the input is absent or malformed.
 * @returns Parsed boolean that preserves deterministic bootstrap behavior.
 */
export function parseBoolean(
  value: string | undefined,
  fallback: boolean,
): boolean {
  if (value === undefined) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

/**
 * Parses integer environment values while preserving a deterministic fallback on bad input.
 *
 * @param value - Raw environment value.
 * @param fallback - Integer used when parsing fails.
 * @returns Parsed integer or the provided fallback.
 */
export function parseInteger(
  value: string | undefined,
  fallback: number,
): number {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Loads and normalizes orchestrator configuration from the environment once so downstream handlers observe stable values.
 *
 * @returns Sanitized configuration consumed by runtime bootstrap and request handling.
 */
export function loadConfig() {
  return {
    mode: FULL_MODE,
    logLevel: process.env.MYBRAIN_LOG_LEVEL ?? "info",
    llmModel: process.env.MYBRAIN_LLM_MODEL ?? "qwen3.5:0.8b",
    dbUrl: process.env.MYBRAIN_DB_URL ?? "",
    llmUrl: process.env.MYBRAIN_LLM_URL ?? "",
    embeddingModel:
      (process.env.MYBRAIN_EMBEDDING_MODEL || "qwen3-embedding:0.6b").trim() ||
      "qwen3-embedding:0.6b",
    embeddingDim: parseInteger(process.env.MYBRAIN_EMBEDDING_DIM, 1024),
    vectorPort: parseInteger(process.env.RUVECTOR_PORT, 8080),
    sonaEnabled: parseBoolean(process.env.RUVLLM_SONA_ENABLED, true),
    tokenFile: process.env.MYBRAIN_AUTH_TOKEN_FILE ?? "/run/secrets/auth-token",
    internalApiKey: process.env.MYBRAIN_INTERNAL_API_KEY ?? "",
  };
}
