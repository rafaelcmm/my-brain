declare module "*.mjs";

/**
 * Minimal contract for the ruvector intelligence engine instance.
 * The full API is undocumented; only members used by the orchestrator are typed.
 */
export interface IntelligenceEngine {
  /** Produces an embedding vector for the given text content. */
  embed(content: string): number[] | Promise<number[]>;
  /**
   * Stores a memory entry in the engine and returns an object with a stable id.
   * The id is used as the primary key for sidecar metadata rows in Postgres.
   */
  remember(
    content: string,
    type: string,
  ): Promise<Record<string, unknown> | null | undefined>;
  /** Opens a learning trajectory for SONA session tracking. */
  beginTrajectory(event: string, scope: string): void;
  /** Sets the active route label for the current trajectory. */
  setTrajectoryRoute(route: string): void;
  /** Closes the current trajectory, recording success and quality. */
  endTrajectory(success: boolean, quality?: number): void;
  /** Returns a statistics snapshot; shape is engine-version-dependent. */
  getStats(): Record<string, unknown> | null | undefined;
}

declare module "ruvector";
declare module "@ruvector/ruvllm";
declare module "@ruvector/server";
