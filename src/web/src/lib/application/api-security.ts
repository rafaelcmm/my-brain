import type { NextRequest, NextResponse } from "next/server";

type LimitWindow = { count: number; startedAt: number };

/**
 * In-memory fixed window limiter.
 * Keeps abusive request bursts contained for process-local deployments.
 */
class FixedWindowLimiter {
  private windows = new Map<string, LimitWindow>();

  allow(key: string, maxPerMinute: number): boolean {
    const now = Date.now();
    const windowMs = 60_000;
    const current = this.windows.get(key);

    if (!current || now - current.startedAt >= windowMs) {
      this.windows.set(key, { count: 1, startedAt: now });
      return true;
    }

    if (current.count >= maxPerMinute) {
      return false;
    }

    current.count += 1;
    this.windows.set(key, current);
    return true;
  }
}

const loginLimiter = new FixedWindowLimiter();
const memoryLimiter = new FixedWindowLimiter();

/**
 * Derive best-effort client IP from reverse-proxy headers.
 */
export function getClientIp(request: NextRequest): string {
  const forwarded = request.headers
    .get("x-forwarded-for")
    ?.split(",")[0]
    ?.trim();
  if (forwarded) {
    return forwarded;
  }

  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * Evaluate login fixed-window limit keyed by client IP.
 */
export function isLoginRateLimited(
  request: NextRequest,
  maxAttemptsPerMinute: number,
): boolean {
  return !loginLimiter.allow(getClientIp(request), maxAttemptsPerMinute);
}

/**
 * Evaluate memory API fixed-window limit keyed by session id + client IP.
 */
export function isMemoryRateLimited(
  request: NextRequest,
  sessionId: string,
  maxRequestsPerMinute = 60,
): boolean {
  const key = `${sessionId}:${getClientIp(request)}`;
  return !memoryLimiter.allow(key, maxRequestsPerMinute);
}

/**
 * Apply no-store cache policy on auth-sensitive responses.
 */
export function applyNoStoreHeaders(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  return response;
}
