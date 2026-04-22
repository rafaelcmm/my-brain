/**
 * Facade for Postgres-backed memory persistence and recall operations.
 *
 * The concrete implementations are split by responsibility in
 * `infrastructure/postgres-memory/*` so each module has one clear purpose
 * while preserving the stable import surface used by handlers and tests.
 */

export type {
  DuplicateMatch,
  RecallCandidate,
  RecallFilters,
  VoteAggregate,
} from "./postgres-memory/types.js";

export { queryRecallCandidates } from "./postgres-memory/recall-query.js";
export { findDuplicateMemory } from "./postgres-memory/dedup.js";
export { loadVoteBias } from "./postgres-memory/vote-loading.js";
export { persistMemoryMetadata } from "./postgres-memory/persist.js";
