import { sanitizeText } from "../domain/memory-validation.js";
import { parseInteger } from "../config/load-config.js";

const rateWindowMs = 60_000;
const rateLimitPerWindow = parseInteger(
  process.env.MYBRAIN_RATE_LIMIT_PER_MIN,
  60,
);
const rateBuckets = new Map<string, { windowStart: number; count: number }>();

/**
 * Applies fixed-window rate limiting keyed by endpoint class plus caller identity.
 *
 * @param req - Incoming request carrying caller address headers.
 * @param endpointKey - Stable endpoint class key used to isolate buckets.
 * @returns True when the request may proceed under the current fixed window policy.
 */
export function allowRequest(
  req: {
    headers: Record<string, unknown>;
    socket?: { remoteAddress?: string | null };
  },
  endpointKey: string,
): boolean {
  const caller =
    sanitizeText(req.headers["x-forwarded-for"], 128) ??
    sanitizeText(req.socket?.remoteAddress, 128) ??
    "unknown";
  const now = Date.now();
  const bucketKey = `${endpointKey}:${caller}`;
  const entry = rateBuckets.get(bucketKey);

  if (!entry || now - entry.windowStart >= rateWindowMs) {
    rateBuckets.set(bucketKey, { windowStart: now, count: 1 });
    return true;
  }

  if (entry.count >= rateLimitPerWindow) {
    return false;
  }

  entry.count += 1;
  rateBuckets.set(bucketKey, entry);
  return true;
}
