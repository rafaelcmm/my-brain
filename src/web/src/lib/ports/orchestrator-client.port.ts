/**
 * Port: HTTP client for communicating with the orchestrator REST API.
 * Implementations should inject the bearer token and handle errors.
 */
export interface OrchestratorClient {
  /**
   * Get orchestrator capabilities (auth check).
   * @returns { version: string, mode: string } on success.
   * @throws OrchestratorAuthError on 401.
   * @throws OrchestratorUnavailableError on connection failure.
   */
  getCapabilities(): Promise<{ version: string; mode: string }>;

  /**
   * Check health of the orchestrator.
   * @returns true if orchestrator is healthy.
   */
  health(): Promise<boolean>;

  /**
   * Get brain summary statistics.
   * @returns BrainSummary object.
   */
  getBrainSummary(): Promise<Record<string, unknown>>;

  /**
   * List memories with optional filters and pagination.
   * @param filters Optional filter criteria.
   * @param cursor Optional pagination cursor.
   * @returns Array of memories and next cursor.
   */
  listMemories(filters?: {
    scope?: string;
    type?: string;
    repo?: string;
    language?: string;
    tag?: string;
    search?: string;
  }, cursor?: string): Promise<{ memories: unknown[]; next_cursor?: string }>;

  /**
   * Get a single memory by ID.
   */
  getMemory(id: string): Promise<unknown>;

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
  ): Promise<unknown>;

  /**
   * Forget (delete) a memory.
   */
  forgetMemory(id: string): Promise<void>;

  /**
   * Get knowledge graph snapshot.
   * @param limit Maximum number of nodes.
   * @param minSimilarity Minimum similarity threshold for edges.
   */
  getMemoryGraph(limit?: number, minSimilarity?: number): Promise<{
    nodes: unknown[];
    edges: unknown[];
  }>;

  /**
   * Run a recall query.
   */
  recall(query: string, scope?: string): Promise<unknown>;

  /**
   * Run a digest query.
   */
  digest(scope?: string, type?: string): Promise<unknown>;
}

/**
 * Domain errors emitted by OrchestratorClient.
 */
export class OrchestratorError extends Error {
  constructor(message: string, readonly code: string) {
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
