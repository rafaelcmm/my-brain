import type {
  BrainSummary,
  GraphSnapshot,
  Memory,
  ToolResponseEnvelope,
} from "@/lib/domain";

/**
 * Raw recall payload carried inside the v2 synthesis envelope.
 */
export interface RecallData {
  query: string;
  top_k: number;
  min_score: number;
  results: unknown[];
}

/**
 * Raw digest payload carried inside the v2 synthesis envelope.
 */
export interface DigestData {
  since?: string;
  rows: unknown[];
  learning: Record<string, unknown>;
}

/**
 * Raw remember payload carried inside the v2 synthesis envelope.
 */
export interface RememberData {
  memory_id: string;
  scope: string;
  type: string;
  deduped: boolean;
  score?: number;
}

/**
 * Raw forget payload carried inside the v2 synthesis envelope.
 */
export interface ForgetData {
  memory_id: string;
  mode: "soft" | "hard";
}

/**
 * Capabilities payload returned by orchestrator v2.
 */
export interface CapabilitiesData {
  capabilities: {
    engine: boolean;
    vectorDb: boolean;
    sona: boolean;
    attention: boolean;
    embeddingDim: number;
  };
  features: {
    vectorDb: boolean;
    sona: boolean;
    attention: boolean;
    embeddingDim: number;
  };
  degradedReasons: string[];
  db: {
    extensionVersion: string | null;
    adrSchemasReady: boolean;
    embeddingProvider: string;
    embeddingReady: boolean;
  };
}

/**
 * Port: HTTP client for communicating with the orchestrator REST API.
 * Implementations should inject the bearer token and handle errors.
 */
export interface OrchestratorClient {
  /**
   * Get orchestrator capabilities (auth check).
    * @returns v2 capabilities envelope on success.
   * @throws OrchestratorAuthError on 401.
   * @throws OrchestratorUnavailableError on connection failure.
   */
    getCapabilities(): Promise<ToolResponseEnvelope<CapabilitiesData>>;

  /**
   * Check health of the orchestrator.
   * @returns true if orchestrator is healthy.
   */
  health(): Promise<boolean>;

  /**
   * Get brain summary statistics.
   * @returns BrainSummary object.
   */
  getBrainSummary(): Promise<BrainSummary>;

  /**
   * List memories with optional filters and pagination.
   * @param filters Optional filter criteria.
   * @param cursor Optional pagination cursor.
   * @returns Array of memories and next cursor.
   */
  listMemories(
    filters?: {
      scope?: string;
      type?: string;
      repo?: string;
      language?: string;
      tag?: string;
      search?: string;
    },
    cursor?: string,
  ): Promise<{ memories: Memory[]; next_cursor?: string | null }>;

  /**
   * Get a single memory by ID.
   * @returns The memory if found, or null if it does not exist or was forgotten.
   */
  getMemory(id: string): Promise<Memory | null>;

  /**
   * Create a new memory.
   * @param content Memory content.
   * @param type Memory type.
   * @param scope Memory scope.
   * @param metadata Additional metadata.
   * @returns Created memory.
   */
  createMemory(
    content: string,
    type: string,
    scope: string,
    metadata: Record<string, unknown>,
  ): Promise<ToolResponseEnvelope<RememberData>>;

  /**
   * Forget (delete) a memory.
   */
  forgetMemory(id: string): Promise<ToolResponseEnvelope<ForgetData>>;

  /**
   * Get knowledge graph snapshot.
   * @param limit Maximum number of nodes.
   * @param minSimilarity Minimum similarity threshold for edges.
   */
  getMemoryGraph(
    limit?: number,
    minSimilarity?: number,
  ): Promise<GraphSnapshot>;

  /**
   * Run a recall query.
   */
  recall(query: string, scope?: string): Promise<ToolResponseEnvelope<RecallData>>;

  /**
   * Run a digest query.
   */
  digest(scope?: string, type?: string): Promise<ToolResponseEnvelope<DigestData>>;
}

/**
 * Domain errors emitted by OrchestratorClient.
 */
export class OrchestratorError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "OrchestratorError";
  }
}

export class OrchestratorAuthError extends OrchestratorError {
  constructor(message = "Authentication failed") {
    super(message, "AUTH_ERROR");
    this.name = "OrchestratorAuthError";
  }
}

export class OrchestratorUnavailableError extends OrchestratorError {
  constructor(message = "Orchestrator unavailable") {
    super(message, "UNAVAILABLE_ERROR");
    this.name = "OrchestratorUnavailableError";
  }
}

export class OrchestratorValidationError extends OrchestratorError {
  constructor(message: string) {
    super(message, "VALIDATION_ERROR");
    this.name = "OrchestratorValidationError";
  }
}

/**
 * Port: Server-side session store for encrypted bearer token storage.
 * Bearers are stored server-side, keyed by session ID, never in the cookie payload.
 */
export interface SessionStore {
  /**
   * Create a new session with an encrypted bearer token.
   * @returns session ID to be set as an httpOnly cookie.
   */
  createSession(bearerToken: string, ttl?: number): Promise<string>;

  /**
   * Retrieve the bearer token for a given session.
   * @returns bearer token, or null if session not found or expired.
   */
  getBearer(sessionId: string): Promise<string | null>;

  /**
   * Destroy a session, invalidating the bearer.
   */
  destroySession(sessionId: string): Promise<void>;

  /**
   * Verify CSRF token for a session and action.
   */
  verifyCSRFToken(sessionId: string, token: string): Promise<boolean>;

  /**
   * Get a CSRF token for a session.
   */
  getCSRFToken(sessionId: string): Promise<string>;
}

/**
 * Port: Logger for structured logging.
 */
export interface Logger {
  trace(message: string, meta?: Record<string, unknown>): void;
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  fatal(message: string, meta?: Record<string, unknown>): void;
}
