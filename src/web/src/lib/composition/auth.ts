import { cookies } from "next/headers";
import { AuthenticateUseCase } from "@/lib/application/authenticate.usecase";
import { env } from "@/lib/config/env";
import { HttpOrchestratorClient } from "@/lib/infrastructure/orchestrator/http-orchestrator-client";
import { getSessionStore } from "@/lib/infrastructure/session/store";
import type { OrchestratorClient } from "@/lib/ports/orchestrator-client.port";

/**
 * Build authenticated orchestrator client from current request cookies.
 * Returns null when session is missing or expired.
 */
export async function getAuthenticatedClient(): Promise<OrchestratorClient | null> {
  const sessionId = await getSessionIdFromCookies();
  if (!sessionId) {
    return null;
  }

  const bearer = await getSessionStore().getBearer(sessionId);
  if (!bearer) {
    return null;
  }

  const config = env();
  return new HttpOrchestratorClient(
    config.MYBRAIN_WEB_ORCHESTRATOR_URL,
    bearer,
    config.MYBRAIN_INTERNAL_API_KEY,
  );
}

/**
 * Exchange bearer token for server-side session id using authentication use case.
 */
export async function authenticateToken(token: string): Promise<string> {
  const config = env();

  const createClient = (bearerToken: string) =>
    new HttpOrchestratorClient(
      config.MYBRAIN_WEB_ORCHESTRATOR_URL,
      bearerToken,
      config.MYBRAIN_INTERNAL_API_KEY,
    );

  const useCase = new AuthenticateUseCase(createClient, getSessionStore());
  return useCase.authenticate(token);
}

/**
 * Resolve and validate bearer from session cookie.
 */
export async function resolveSessionBearer(): Promise<{ sessionId: string; bearer: string } | null> {
  const sessionId = await getSessionIdFromCookies();
  if (!sessionId) {
    return null;
  }

  const bearer = await getSessionStore().getBearer(sessionId);
  if (!bearer) {
    return null;
  }

  return { sessionId, bearer };
}

/**
 * Read CSRF token for active session.
 */
export async function getSessionCsrfToken(sessionId: string): Promise<string> {
  return getSessionStore().getCSRFToken(sessionId);
}

/**
 * Verify CSRF token for active session.
 */
export async function verifySessionCsrfToken(
  sessionId: string,
  token: string,
): Promise<boolean> {
  return getSessionStore().verifyCSRFToken(sessionId, token);
}

/**
 * Destroy session by id.
 */
export async function destroySession(sessionId: string): Promise<void> {
  await getSessionStore().destroySession(sessionId);
}

/**
 * Read session id from current request cookies.
 */
export async function getSessionIdFromCookies(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get("session")?.value ?? null;
}
