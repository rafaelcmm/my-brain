import { cookies } from "next/headers";
import { env } from "@/lib/config/env";
import { HttpOrchestratorClient } from "@/lib/infrastructure/orchestrator/http-orchestrator-client";
import { getSessionStore } from "@/lib/infrastructure/session/store";

/**
 * Builds an authenticated orchestrator client from current session cookie.
 *
 * Returns null when session is missing/expired so callers can redirect
 * or render unauthenticated fallback without leaking auth details.
 */
export async function getAuthenticatedClient(): Promise<HttpOrchestratorClient | null> {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get("session")?.value;
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
