import type { MemoryMetadata } from "@/lib/domain/metadata";

/**
 * Unique identifier for a memory.
 */
export type MemoryId = string & { readonly __brand: "MemoryId" };

/**
 * Semantic memory classification.
 */
export type MemoryType =
  | "decision"
  | "fix"
  | "convention"
  | "gotcha"
  | "tradeoff"
  | "pattern"
  | "reference";

/**
 * Recall scope: repo, project, or global.
 */
export type MemoryScope = "repo" | "project" | "global";

/**
 * Persisted memory aggregate.
 */
export interface Memory {
  id: MemoryId;
  content: string;
  type: MemoryType;
  scope: MemoryScope;
  metadata: MemoryMetadata;
  created_at: string;
  updated_at: string;
}
