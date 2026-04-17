/**
 * Output payload for learn use-case.
 */
export interface LearnOutput {
  /** Engine status message returned by forced learning cycle. */
  readonly status: string;

  /** Parsed stats snapshot for observability. */
  readonly stats: Record<string, unknown>;
}
