import type { MemoryId, MemoryScope, MemoryType } from "@/lib/domain/memory";

/**
 * Render node for knowledge graph view.
 */
export interface GraphNode {
  id: MemoryId;
  label: string;
  type: MemoryType;
  size: number;
  scope: MemoryScope;
}

/**
 * Graph relation between memory nodes.
 */
export interface GraphEdge {
  source: MemoryId;
  target: MemoryId;
  reason: "shared-repo" | "shared-tags" | "similarity";
  weight?: number;
}

/**
 * Graph snapshot payload consumed by webapp.
 */
export interface GraphSnapshot {
  nodes: GraphNode[];
  edges: GraphEdge[];
  total_count: number;
}
