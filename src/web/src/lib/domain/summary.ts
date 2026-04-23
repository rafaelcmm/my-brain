/**
 * Aggregated top-entry item with label and count.
 */
export interface TopEntry {
  count: number;
}

/**
 * Summary statistics for dashboard and analytics views.
 */
export interface BrainSummary {
  total_memories: number;
  by_scope: Record<string, number>;
  by_type: Record<string, number>;
  top_tags: Array<TopEntry & { tag: string }>;
  top_frameworks: Array<TopEntry & { framework: string }>;
  top_languages: Array<TopEntry & { language: string }>;
  learning_stats: Record<string, number>;
}
