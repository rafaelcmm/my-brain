import { sanitizeText } from "../domain/memory-validation.js";
import { parseInteger } from "../config/load-config.js";

const rateWindowMs = 60_000;
const rateLimitPerWindow = parseInteger(
  process.env.MYBRAIN_RATE_LIMIT_PER_MIN,
  60,
);

/**
 * Maximum number of distinct caller+endpoint buckets held in memory at once.
 *
 * Bounds heap growth for deployments with many unique callers. When the cap is
 * reached the oldest bucket (by window start) is evicted before inserting a
 * new one, so count accuracy is preserved for active callers.
 */
const BUCKET_MAX_SIZE = parseInteger(
  process.env.MYBRAIN_RATE_BUCKET_MAX_SIZE,
  10_000,
);

/**
 * How long (ms) an idle bucket is retained before passive eviction on next sweep.
 *
 * Buckets are also eagerly replaced when their window expires, so TTL is a
 * secondary safety net for callers that stop sending requests entirely.
 */
const BUCKET_TTL_MS = parseInteger(
  process.env.MYBRAIN_RATE_BUCKET_TTL_MS,
  // Default: two windows — enough headroom to absorb a quiet minute.
  rateWindowMs * 2,
);

interface RateBucket {
  windowStart: number;
  count: number;
  /** Epoch ms of the last request that touched this bucket, used for TTL eviction. */
  lastSeenAt: number;
}

const rateBuckets = new Map<string, RateBucket>();

/**
 * Evicts all buckets whose `lastSeenAt` is older than `BUCKET_TTL_MS`.
 *
 * Called before every insert so idle callers do not accumulate indefinitely.
 * Runs in O(n) over the current map size; expected cheap because most callers
 * are active and TTL sweeps remove the long tail.
 */
function evictExpiredBuckets(now: number): void {
  for (const [key, entry] of rateBuckets) {
    if (now - entry.lastSeenAt > BUCKET_TTL_MS) {
      rateBuckets.delete(key);
    }
  }
}

/**
 * Evicts the single oldest bucket when the map is at capacity.
 *
 * Protects against a thundering-herd of new unique callers exhausting memory.
 * Evicting the oldest entry is O(1) for Maps because iteration order is
 * insertion order in V8, so the first entry is the oldest still present.
 */
function evictOldestBucket(): void {
  const firstKey = rateBuckets.keys().next().value;
  if (firstKey !== undefined) {
    rateBuckets.delete(firstKey);
  }
}

/**
 * Applies fixed-window rate limiting keyed by endpoint class plus caller identity.
 *
 * Buckets are bounded by `BUCKET_MAX_SIZE` and expired after `BUCKET_TTL_MS`
 * of inactivity, preventing unbounded map growth in long-running deployments.
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
    // New caller or expired window — evict stale entries before inserting.
    evictExpiredBuckets(now);
    if (rateBuckets.size >= BUCKET_MAX_SIZE) {
      evictOldestBucket();
    }
    rateBuckets.set(bucketKey, { windowStart: now, count: 1, lastSeenAt: now });
    return true;
  }

  if (entry.count >= rateLimitPerWindow) {
    // Still update lastSeenAt so the bucket is not TTL-evicted while the
    // caller is actively being rate-limited.
    entry.lastSeenAt = now;
    return false;
  }

  entry.count += 1;
  entry.lastSeenAt = now;
  return true;
}

/**
 * Returns the current number of tracked rate-limit buckets.
 *
 * Exposed for observability and unit testing; not intended for production
 * hot-path use.
 */
export function rateBucketCount(): number {
  return rateBuckets.size;
}

/**
 * Clears all rate-limit buckets.
 *
 * Intended for test isolation only — do not call in production code paths.
 */
export function clearRateBuckets(): void {
  rateBuckets.clear();
}
