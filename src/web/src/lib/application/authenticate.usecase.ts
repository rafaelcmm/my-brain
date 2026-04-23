import type { OrchestratorClient } from "@/lib/ports/orchestrator-client.port";
import { OrchestratorAuthError } from "@/lib/ports/orchestrator-client.port";
import type { SessionStore } from "@/lib/ports/orchestrator-client.port";

/**
 * Use case: Authenticate with a bearer token.
 * Verifies token by calling orchestrator; creates session on success.
 */
export class AuthenticateUseCase {
  constructor(
    private createOrchestratorClient: (token: string) => OrchestratorClient,
    private sessionStore: SessionStore,
  ) {}

  /**
   * Authenticate with a bearer token.
   * @param bearerToken The token pasted by the user
   * @returns Session ID (to set as httpOnly cookie)
   * @throws OrchestratorAuthError if token is invalid
   */
  async authenticate(bearerToken: string): Promise<string> {
    // Create temp client with test bearer to verify token
    const tempClient = this.createOrchestratorClient(bearerToken);

    try {
      await tempClient.getCapabilities();
    } catch (error) {
      if (error instanceof OrchestratorAuthError) {
        throw new OrchestratorAuthError("Invalid or expired token");
      }
      throw error;
    }

    // Token is valid; create session
    const sessionId = await this.sessionStore.createSession(bearerToken);

    return sessionId;
  }
}
