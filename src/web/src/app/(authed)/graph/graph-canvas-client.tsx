"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ELK from "elkjs/lib/elk.bundled.js";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { GraphSnapshot } from "@/lib/domain";

const elk = new ELK();

interface GraphCanvasClientProps {
  graph: GraphSnapshot;
}

/**
 * Narrow union used by relation filters and edge styling controls.
 */
type EdgeReason = GraphSnapshot["edges"][number]["reason"];

/**
 * Centralized relation styling so legend, toggles, and edge rendering stay consistent.
 */
const REASON_CONFIG: Record<
  EdgeReason,
  {
    label: string;
    color: string;
    strokeWidth: number;
  }
> = {
  "shared-repo": {
    label: "Shared repo",
    color: "#0f766e",
    strokeWidth: 2,
  },
  "shared-tags": {
    label: "Shared tags",
    color: "#b45309",
    strokeWidth: 2,
  },
  similarity: {
    label: "Similarity",
    color: "#2563eb",
    strokeWidth: 2.5,
  },
};

/**
 * Interactive graph renderer with elk layout, filtering, and inspection panel.
 */
export function GraphCanvasClient({ graph }: GraphCanvasClientProps) {
  const [scopeFilter, setScopeFilter] = useState<string>("all");
  const [minEdgeWeight, setMinEdgeWeight] = useState<number>(0);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showOnlyNeighbors, setShowOnlyNeighbors] = useState(false);
  const [enabledReasons, setEnabledReasons] = useState<Record<EdgeReason, boolean>>({
    "shared-repo": true,
    "shared-tags": true,
    similarity: true,
  });
  const [layoutedNodes, setLayoutedNodes] = useState<Node[]>([]);
  const [layoutedEdges, setLayoutedEdges] = useState<Edge[]>([]);
  const [isLayouting, setIsLayouting] = useState(false);
  const flowRef = useRef<ReactFlowInstance<Node, Edge> | null>(null);

  const scopes = useMemo(() => {
    const unique = new Set(graph.nodes.map((node) => node.scope));
    return ["all", ...Array.from(unique)];
  }, [graph.nodes]);

  const filteredGraph = useMemo(() => {
    const nodesByScope = graph.nodes.filter(
      (node) => scopeFilter === "all" || node.scope === scopeFilter,
    );
    const visibleNodeIds = new Set(nodesByScope.map((node) => node.id));

    const edgesByScope = graph.edges.filter((edge) => {
      if (
        !visibleNodeIds.has(edge.source) ||
        !visibleNodeIds.has(edge.target)
      ) {
        return false;
      }

      if (!enabledReasons[edge.reason]) {
        return false;
      }

      const weight = edge.weight ?? 1;
      return weight >= minEdgeWeight;
    });

    if (!showOnlyNeighbors || !selectedNodeId) {
      return { nodes: nodesByScope, edges: edgesByScope };
    }

    const neighborIds = new Set<string>([selectedNodeId]);
    for (const edge of edgesByScope) {
      if (edge.source === selectedNodeId) {
        neighborIds.add(edge.target);
      }
      if (edge.target === selectedNodeId) {
        neighborIds.add(edge.source);
      }
    }

    const nodes = nodesByScope.filter((node) => neighborIds.has(node.id));
    const nodeIds = new Set(nodes.map((node) => node.id));
    const edges = edgesByScope.filter(
      (edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target),
    );

    return { nodes, edges };
  }, [
    enabledReasons,
    graph,
    minEdgeWeight,
    scopeFilter,
    selectedNodeId,
    showOnlyNeighbors,
  ]);

  const neighborhoodNodeIds = useMemo(() => {
    if (!selectedNodeId) {
      return new Set<string>();
    }

    const ids = new Set<string>([selectedNodeId]);
    for (const edge of filteredGraph.edges) {
      if (edge.source === selectedNodeId) {
        ids.add(edge.target);
      }
      if (edge.target === selectedNodeId) {
        ids.add(edge.source);
      }
    }

    return ids;
  }, [filteredGraph.edges, selectedNodeId]);

  useEffect(() => {
    let cancelled = false;

    const runLayout = async () => {
      setIsLayouting(true);

      const elkGraph = {
        id: "memory-graph",
        layoutOptions: {
          "elk.algorithm": "layered",
          "elk.direction": "RIGHT",
          "elk.layered.spacing.nodeNodeBetweenLayers": "80",
          "elk.spacing.nodeNode": "40",
        },
        children: filteredGraph.nodes.map((node) => ({
          id: node.id,
          width: 180,
          height: Math.max(48, Math.min(120, node.size * 8)),
        })),
        edges: filteredGraph.edges.map((edge, index) => ({
          id: `${edge.source}-${edge.target}-${index}`,
          sources: [edge.source],
          targets: [edge.target],
        })),
      };

      const layout = await elk.layout(elkGraph);
      if (cancelled) {
        return;
      }

      const nodes: Node[] = filteredGraph.nodes.map((node) => {
        const elkNode = layout.children?.find((child) => child.id === node.id);
        const isSelected = selectedNodeId === node.id;
        const isNeighbor = neighborhoodNodeIds.has(node.id);
        const shouldDim = selectedNodeId !== null && !isNeighbor;

        return {
          id: node.id,
          position: {
            x: elkNode?.x ?? 0,
            y: elkNode?.y ?? 0,
          },
          data: {
            label: node.label,
            type: node.type,
            scope: node.scope,
            size: node.size,
          },
          style: {
            width: 180,
            borderRadius: 12,
            border: isSelected ? "2px solid #1d4ed8" : "1px solid #d1d5db",
            background: node.type === "decision" ? "#dbeafe" : "#f8fafc",
            fontSize: 12,
            padding: 8,
            opacity: shouldDim ? 0.3 : 1,
          },
        };
      });

      const edges: Edge[] = filteredGraph.edges.map((edge, index) => {
        const reasonConfig = REASON_CONFIG[edge.reason];
        const weight = edge.weight ?? 1;
        const touchesSelection =
          selectedNodeId !== null &&
          (edge.source === selectedNodeId || edge.target === selectedNodeId);
        const shouldDim = selectedNodeId !== null && !touchesSelection;

        return {
          id: `${edge.source}-${edge.target}-${index}`,
          source: edge.source,
          target: edge.target,
          animated: edge.reason === "similarity" && !shouldDim,
          label: edge.reason,
          style: {
            stroke: reasonConfig.color,
            strokeWidth: reasonConfig.strokeWidth + Math.min(2.5, weight * 2),
            opacity: shouldDim ? 0.2 : 0.8,
          },
          labelStyle: {
            fill: reasonConfig.color,
            fontSize: 10,
            fontWeight: 600,
          },
        };
      });

      setLayoutedNodes(nodes);
      setLayoutedEdges(edges);
      setIsLayouting(false);

      requestAnimationFrame(() => {
        flowRef.current?.fitView({ padding: 0.2, duration: 300 });
      });
    };

    runLayout().catch(() => {
      if (!cancelled) {
        setIsLayouting(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [filteredGraph, neighborhoodNodeIds, selectedNodeId]);

  const selectedNode = useMemo(
    () => graph.nodes.find((node) => node.id === selectedNodeId) ?? null,
    [graph.nodes, selectedNodeId],
  );

  const handleNodeClick: NodeMouseHandler<Node> = (_, node) => {
    setSelectedNodeId(node.id);
  };

  /**
   * Exports current graph viewport as PNG; no-ops when SVG/canvas APIs are unavailable.
   */
  async function exportPng(): Promise<void> {
    const svg = document.querySelector(".react-flow__viewport")?.closest("svg");
    if (!svg) {
      return;
    }

    const serializer = new XMLSerializer();
    const source = serializer.serializeToString(svg);
    const encoded = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;

    const image = new Image();
    image.src = encoded;

    await new Promise((resolve) => {
      image.onload = resolve;
    });

    const canvas = document.createElement("canvas");
    canvas.width = image.width || 1600;
    canvas.height = image.height || 900;

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0);

    const link = document.createElement("a");
    link.download = "memory-graph.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  return (
    <section className="bg-white rounded-lg shadow p-4 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-gray-700">
          Scope
          <select
            className="ml-2 border rounded px-2 py-1"
            value={scopeFilter}
            onChange={(event) => setScopeFilter(event.target.value)}
          >
            {scopes.map((scope) => (
              <option key={scope} value={scope}>
                {scope}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm text-gray-700">
          Min edge weight
          <input
            className="ml-2 align-middle"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={minEdgeWeight}
            onChange={(event) => setMinEdgeWeight(Number(event.target.value))}
          />
          <span className="ml-2 text-xs text-gray-500">
            {minEdgeWeight.toFixed(2)}
          </span>
        </label>

        {Object.entries(REASON_CONFIG).map(([reason, config]) => {
          const typedReason = reason as EdgeReason;
          return (
            <label key={reason} className="text-sm text-gray-700 flex items-center gap-2">
              <input
                type="checkbox"
                checked={enabledReasons[typedReason]}
                onChange={(event) => {
                  setEnabledReasons((current) => ({
                    ...current,
                    [typedReason]: event.target.checked,
                  }));
                }}
              />
              <span
                className="inline-block w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: config.color }}
              />
              {config.label}
            </label>
          );
        })}

        <label className="text-sm text-gray-700 flex items-center gap-2">
          <input
            type="checkbox"
            checked={showOnlyNeighbors}
            disabled={!selectedNodeId}
            onChange={(event) => setShowOnlyNeighbors(event.target.checked)}
          />
          Focus selected node
        </label>

        <button
          type="button"
          className="rounded bg-gray-900 px-3 py-1 text-sm text-white"
          onClick={() =>
            flowRef.current?.fitView({ padding: 0.2, duration: 300 })
          }
        >
          Zoom to fit
        </button>

        <button
          type="button"
          className="rounded bg-blue-700 px-3 py-1 text-sm text-white"
          onClick={exportPng}
        >
          Export PNG
        </button>

        {isLayouting ? (
          <span className="text-xs text-amber-700">Re-layouting...</span>
        ) : null}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4">
        <div className="h-[680px] rounded border bg-slate-50">
          <ReactFlow
            nodes={layoutedNodes}
            edges={layoutedEdges}
            fitView
            onNodeClick={handleNodeClick}
            onInit={(instance: ReactFlowInstance<Node, Edge>) => {
              flowRef.current = instance;
            }}
          >
            <MiniMap />
            <Controls />
            <Background gap={18} size={1} />
          </ReactFlow>
        </div>

        <aside className="rounded border bg-white p-4 space-y-2">
          <div className="rounded border border-gray-200 bg-gray-50 p-3 space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Visible graph
            </h2>
            <div className="text-sm text-gray-700">
              <p>Nodes: {filteredGraph.nodes.length}</p>
              <p>Edges: {filteredGraph.edges.length}</p>
              <p>
                Focus: {selectedNodeId ? `${neighborhoodNodeIds.size - 1} connected` : "none"}
              </p>
            </div>
          </div>

          <div className="rounded border border-gray-200 p-3 space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Relation legend
            </h2>
            {Object.entries(REASON_CONFIG).map(([reason, config]) => (
              <p key={reason} className="text-sm text-gray-700 flex items-center gap-2">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: config.color }}
                />
                <span className="font-medium">{config.label}</span>
                <span className="text-xs text-gray-500">({reason})</span>
              </p>
            ))}
          </div>

          <h2 className="text-sm font-semibold uppercase text-gray-500">
            Node details
          </h2>
          {!selectedNode ? (
            <p className="text-sm text-gray-600">
              Click a node to inspect details.
            </p>
          ) : (
            <div className="space-y-2 text-sm text-gray-800">
              <p>
                <span className="font-semibold">ID:</span> {selectedNode.id}
              </p>
              <p>
                <span className="font-semibold">Type:</span> {selectedNode.type}
              </p>
              <p>
                <span className="font-semibold">Scope:</span>{" "}
                {selectedNode.scope}
              </p>
              <p>
                <span className="font-semibold">Size:</span> {selectedNode.size}
              </p>
              <p className="whitespace-pre-wrap">
                <span className="font-semibold">Label:</span>{" "}
                {selectedNode.label}
              </p>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
