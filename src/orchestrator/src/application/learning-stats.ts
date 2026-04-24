/**
 * Persistent learning telemetry query helpers.
 *
 * Why this module exists: dashboard and API endpoints must report counters from
 * durable session rows, not process-local runtime state that resets on restart.
 */

import type { Pool } from "pg";

/**
 * Canonical persisted learning telemetry exposed to HTTP handlers.
 */
export interface PersistedLearningStats {
  /** Count of all session rows ever opened. */
  sessions_opened: number;
  /** Count of sessions that were explicitly closed. */
  sessions_closed: number;
  /** Closed sessions with success=true. */
  successful_sessions: number;
  /** Closed sessions with success=false. */
  failed_sessions: number;
  /** Mean quality across rows where quality was provided. */
  average_quality: number;
  /** Most recent observed agent route label. */
  route: string;
  /** Confidence reconstructed from success/failure outcomes. */
  route_confidence: number;
}

/**
 * Reads learning counters from my_brain_sessions and reconstructs route confidence.
 *
 * Confidence reconstruction intentionally mirrors runtime nudging logic so the
 * persisted view stays compatible with existing dashboard semantics.
 *
 * @param pool - Active Postgres pool bound to orchestrator runtime.
 * @returns Aggregated persisted telemetry suitable for API responses.
 */
export async function getPersistedLearningStats(
  pool: Pool,
): Promise<PersistedLearningStats> {
  const [aggregateResult, routeResult] = await Promise.all([
    pool.query<{
      sessions_opened: number;
      sessions_closed: number;
      successful_sessions: number;
      failed_sessions: number;
      average_quality: number | null;
    }>(
      `SELECT
        COUNT(*)::int AS sessions_opened,
        COUNT(*) FILTER (WHERE closed_at IS NOT NULL)::int AS sessions_closed,
        COUNT(*) FILTER (WHERE success IS TRUE)::int AS successful_sessions,
        COUNT(*) FILTER (WHERE success IS FALSE)::int AS failed_sessions,
        AVG(quality) FILTER (WHERE quality IS NOT NULL) AS average_quality
       FROM my_brain_sessions`,
    ),
    pool.query<{ route: string }>(
      `SELECT COALESCE(agent, 'default') AS route
       FROM my_brain_sessions
       ORDER BY opened_at DESC
       LIMIT 1`,
    ),
  ]);

  const row = aggregateResult.rows[0];
  const sessionsOpened = row?.sessions_opened ?? 0;
  const sessionsClosed = row?.sessions_closed ?? 0;
  const successfulSessions = row?.successful_sessions ?? 0;
  const failedSessions = row?.failed_sessions ?? 0;

  return {
    sessions_opened: sessionsOpened,
    sessions_closed: sessionsClosed,
    successful_sessions: successfulSessions,
    failed_sessions: failedSessions,
    average_quality: Number(((row?.average_quality ?? 0) as number).toFixed(3)),
    route: routeResult.rows[0]?.route ?? "default",
    route_confidence: Number(
      Math.max(
        0.05,
        Math.min(0.99, 0.5 + (successfulSessions - failedSessions) * 0.05),
      ).toFixed(3),
    ),
  };
}
