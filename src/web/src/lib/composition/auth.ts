import { cookies } from "next/headers";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { AuthenticateUseCase } from "@/lib/application/authenticate.usecase";
import { env } from "@/lib/config/env";
import { HttpOrchestratorClient } from "@/lib/infrastructure/orchestrator/http-orchestrator-client";
import { getSessionStore } from "@/lib/infrastructure/session/store";
import type { OrchestratorClient } from "@/lib/ports/orchestrator-client.port";
import {
  OrchestratorAuthError,
  OrchestratorUnavailableError,
} from "@/lib/ports/orchestrator-client.port";

/**
 * Reads the expected login token from the configured secret file on every call.
 *
 * Why no cache: token rotation must take effect immediately without a server
 * restart. The file read cost on login attempts is negligible.
 *
 * Why multiple candidate paths: local `next dev` reads secrets from the repo,
 * while Docker Compose mounts the same token at `/run/secrets/auth-token`.
 * Trying both keeps web login aligned with the orchestrator secret source in
 * either runtime without coupling bearer validation to the internal API key.
 */
async function getExpectedAuthToken(): Promise<string> {
  const config = env();
  const tokenPaths = [
    config.MYBRAIN_WEB_AUTH_TOKEN_FILE,
    "/run/secrets/auth-token",
    resolve(process.cwd(), ".secrets/auth-token"),
    resolve(process.cwd(), "../../.secrets/auth-token"),
  ].filter(
    (value, index, values) =>
      value.length > 0 && values.indexOf(value) === index,
  );

  let lastError: unknown = null;

  for (const tokenPath of tokenPaths) {
    try {
      const rawToken = await readFile(tokenPath, "utf8");
      const token = rawToken.trim();

      if (!token) {
        lastError = new Error(`Auth token file is empty: ${tokenPath}`);
        continue;
      }

      return token;
    } catch (error) {
      lastError = error;
    }
  }

  throw new OrchestratorUnavailableError(
    `Auth token file is unreadable from known locations: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

/**
 * Validates login token with constant-time comparison to prevent timing leaks.
 */
async function assertExpectedLoginToken(token: string): Promise<void> {
  const expectedToken = await getExpectedAuthToken();
  const provided = Buffer.from(token, "utf8");
  const expected = Buffer.from(expectedToken, "utf8");

  if (provided.length !== expected.length) {
    throw new OrchestratorAuthError("Invalid or expired token");
  }

  if (!timingSafeEqual(provided, expected)) {
    throw new OrchestratorAuthError("Invalid or expired token");
  }
}

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

  // Reject unknown tokens before attempting session creation.
  await assertExpectedLoginToken(token);

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
export async function resolveSessionBearer(): Promise<{
  sessionId: string;
  bearer: string;
} | null> {
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
