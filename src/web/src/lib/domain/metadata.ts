/**
 * Visibility level controlling who can consume memory content.
 */
export type MemoryVisibility = "private" | "team" | "public";

/**
 * Metadata fields attached to memories for filtering and ranking.
 */
export interface MemoryMetadata {
  repo: string | null;
  repo_name: string | null;
  project: string | null;
  language: string | null;
  frameworks: string[];
  path: string | null;
  symbol: string | null;
  tags: string[];
  source: string | null;
  author: string | null;
  agent: string | null;
  created_at: string | null;
  expires_at: string | null;
  confidence: number | null;
  visibility: MemoryVisibility;
  [key: string]: unknown;
}
