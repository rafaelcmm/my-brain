/**
 * Lightweight structured logging helpers used throughout the orchestrator.
 *
 * All functions write to stderr so log lines are separable from HTTP response
 * bodies which go to stdout. No third-party logger is introduced; the orchestrator
 * intentionally keeps its runtime dependency surface minimal.
 */

/**
 * Records a degradation reason onto the supplied array exactly once.
 *
 * Deduplication prevents the health endpoint from emitting the same reason
 * multiple times when initialization paths converge on the same failure.
 *
 * @param reasons - Mutable array owned by the runtime state.
 * @param reason - Human-readable degradation reason to append.
 */
export function pushDegradedReason(reasons: string[], reason: string): void {
  if (!reasons.includes(reason)) {
    reasons.push(reason);
  }
}

/**
 * Converts an internal runtime error message into a non-sensitive status label
 * safe to surface in external API responses.
 *
 * Returning a fixed label rather than the raw message prevents internal paths,
 * dependency names, or stack traces from leaking through the public health endpoint.
 *
 * @param errorMessage - Internal error string, or null when no error is present.
 * @returns `"unavailable"` when an error message is given; `null` otherwise.
 */
export function sanitizeStatusError(
  errorMessage: string | null,
): string | null {
  if (!errorMessage) {
    return null;
  }

  return "unavailable";
}

/**
 * Logs an internal failure without exposing stack details outside debug mode.
 *
 * In non-debug environments only the stable `context` label is emitted so
 * log-aggregation queries remain practical and sensitive output is suppressed.
 * In debug mode the full stack trace (or message) is included for local diagnosis.
 *
 * @param context - Stable, human-readable operation label used in log queries.
 * @param error - Caught error value; may be any unknown thrown type.
 * @param logLevel - Current log level from orchestrator config (`"debug"` enables full output).
 */
export function logInternalError(
  context: string,
  error: unknown,
  logLevel: string,
): void {
  if (logLevel === "debug") {
    process.stderr.write(
      `[my-brain] ${context}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    return;
  }

  process.stderr.write(`[my-brain] ${context}: internal error\n`);
}
