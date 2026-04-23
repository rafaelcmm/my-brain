import { z } from "zod";

/**
 * Strict runtime contracts for orchestrator HTTP payloads.
 *
 * Why strict parse: web adapter sits on trust boundary. Parsing here
 * guarantees malformed upstream data fails fast with typed errors.
 */
export const capabilitiesResponseSchema = z.object({
  capabilities: z
    .object({
      engine: z.boolean().optional(),
    })
    .optional(),
  db: z
    .object({
      extensionVersion: z.string().nullable().optional(),
    })
    .optional(),
});

const topTagSchema = z.object({
  tag: z.string(),
  count: z.number().int().nonnegative(),
});

const topFrameworkSchema = z.object({
  framework: z.string(),
  count: z.number().int().nonnegative(),
});

const topLanguageSchema = z.object({
  language: z.string(),
  count: z.number().int().nonnegative(),
});

/** Dashboard summary payload contract returned by /v1/memory/summary. */
export const brainSummaryResponseSchema = z.object({
  total_memories: z.number().int().nonnegative(),
  by_scope: z.record(z.number().int().nonnegative()),
  by_type: z.record(z.number().int().nonnegative()),
  top_tags: z.array(topTagSchema),
  top_frameworks: z.array(topFrameworkSchema),
  top_languages: z.array(topLanguageSchema),
  learning_stats: z.record(z.number()),
});

/**
 * List item as delivered by orchestrator metadata list endpoint.
 * Metadata is optional in list responses, so mapper builds safe defaults.
 */
export const memoryListItemSchema = z.object({
  id: z.string(),
  content: z.string(),
  type: z.string(),
  scope: z.string(),
  created_at: z.string(),
  updated_at: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  repo_name: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  last_seen_at: z.string().optional(),
  use_count: z.number().int().optional(),
});

/** Response payload contract returned by /v1/memory/list. */
export const memoryListResponseSchema = z.object({
  memories: z.array(memoryListItemSchema).default([]),
  next_cursor: z.string().nullable().optional(),
});

/** Response payload contract returned by /v1/memory/{id}. */
export const memoryByIdResponseSchema = memoryListItemSchema.nullable();

const graphNodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: z.string(),
  size: z.number(),
  scope: z.string(),
});

const graphEdgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  reason: z.enum(["shared-repo", "shared-tags", "similarity"]),
  weight: z.number().optional(),
});

/** Graph payload contract returned by /v1/memory/graph. */
export const graphSnapshotResponseSchema = z.object({
  nodes: z.array(graphNodeSchema),
  edges: z.array(graphEdgeSchema),
  total_count: z.number().int().nonnegative(),
});

export type MemoryListItemDto = z.infer<typeof memoryListItemSchema>;
