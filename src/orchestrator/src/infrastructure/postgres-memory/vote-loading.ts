import type { Pool } from "pg";
import { voteBias } from "../../domain/scoring.js";
import type { VoteAggregate } from "./types.js";

/**
 * Loads aggregate vote counts and pre-computed bias for a page of memory IDs.
 *
 * Returns an empty map when the pool is unavailable or no IDs are provided.
 * The bias value passed to `voteBias` uses Wilson score lower bound so recall
 * scoring degrades gracefully for memories with few votes.
 *
 * @param pool - Active Postgres pool.
 * @param memoryIds - Memory IDs in the current recall page.
 * @returns Map from memory_id to vote aggregate including pre-computed bias.
 */
export async function loadVoteBias(
  pool: Pool,
  memoryIds: string[],
): Promise<Map<string, VoteAggregate>> {
  const result = new Map<string, VoteAggregate>();
  if (memoryIds.length === 0) {
    return result;
  }

  const queryResult = await pool.query<{
    memory_id: string;
    up: string;
    down: string;
  }>(
    `SELECT memory_id,
        SUM(CASE WHEN direction = 'up' THEN 1 ELSE 0 END)::int AS up,
        SUM(CASE WHEN direction = 'down' THEN 1 ELSE 0 END)::int AS down
     FROM my_brain_memory_votes
     WHERE memory_id = ANY($1::text[])
     GROUP BY memory_id`,
    [memoryIds],
  );

  for (const row of queryResult.rows) {
    const up = Number(row.up ?? 0);
    const down = Number(row.down ?? 0);
    result.set(row.memory_id, { up, down, bias: voteBias(up, down) });
  }

  return result;
}
