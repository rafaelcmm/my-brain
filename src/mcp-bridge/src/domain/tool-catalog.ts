import type { BridgeTool } from "./types.js";

/**
 * First-party tools exposed by bridge regardless of upstream availability.
 */
export const BRIDGE_TOOLS: readonly BridgeTool[] = [
  {
    name: "mb_capabilities",
    description: "Canonical runtime capabilities endpoint for my-brain tooling",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "mb_context_probe",
    description:
      "Return derived project context used by metadata-aware memory capture",
    inputSchema: {
      type: "object",
      properties: {
        refresh: {
          type: "boolean",
          description: "Reserved compatibility flag",
        },
        cwd: {
          type: "string",
          description: "Client workspace path hint used for context derivation",
        },
        git_remote: {
          type: "string",
          description: "Git remote hint from client when available",
        },
        repo_hint: {
          type: "string",
          description: "Repository hint when git remote is unavailable",
        },
        project_hint: {
          type: "string",
          description: "Project identifier hint from client workspace",
        },
        language_hint: {
          type: "string",
          description: "Primary language hint from active project",
        },
        framework_hints: {
          type: "array",
          items: { type: "string" },
          description: "Optional framework hints to avoid server-side stubs",
        },
      },
      required: [],
    },
  },
  {
    name: "mb_remember",
    description: "Store memory with metadata envelope",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string" },
        type: { type: "string" },
        scope: { type: "string" },
        metadata: { type: "object" },
      },
      required: ["content", "type", "scope"],
    },
  },
  {
    name: "mb_recall",
    description:
      "Recall memory with scoped metadata filters and minimum score threshold",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        top_k: { type: "number" },
        scope: { type: "string" },
        repo: { type: "string" },
        project: { type: "string" },
        language: { type: "string" },
        frameworks: { type: "array", items: { type: "string" } },
        tags: { type: "array", items: { type: "string" } },
        type: { type: "string" },
        include_expired: { type: "boolean" },
        include_forgotten: { type: "boolean" },
        include_redacted: { type: "boolean" },
        min_score: { type: "number" },
      },
      required: ["query"],
    },
  },
  {
    name: "mb_vote",
    description: "Register up/down vote for memory id",
    inputSchema: {
      type: "object",
      properties: {
        memory_id: { type: "string" },
        direction: { type: "string" },
        reason: { type: "string" },
      },
      required: ["memory_id", "direction"],
    },
  },
  {
    name: "mb_forget",
    description: "Soft/hard forget memory by id",
    inputSchema: {
      type: "object",
      properties: {
        memory_id: { type: "string" },
        mode: { type: "string", description: "soft or hard" },
      },
      required: ["memory_id"],
    },
  },
  {
    name: "mb_session_open",
    description: "Open tracked learning session",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        agent: { type: "string" },
        context: { type: "object" },
      },
      required: [],
    },
  },
  {
    name: "mb_session_close",
    description: "Close tracked learning session",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        success: { type: "boolean" },
        quality: { type: "number" },
        reason: { type: "string" },
      },
      required: ["session_id"],
    },
  },
  {
    name: "mb_digest",
    description: "Summarize learned memories by type/language/repo",
    inputSchema: {
      type: "object",
      properties: {
        since: { type: "string" },
      },
      required: [],
    },
  },
];
