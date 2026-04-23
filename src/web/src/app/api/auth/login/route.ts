import { NextRequest, NextResponse } from "next/server";
import { AuthenticateUseCase } from "@/lib/application/authenticate.usecase";
import { env } from "@/lib/config/env";
import { HttpOrchestratorClient } from "@/lib/infrastructure/orchestrator/http-orchestrator-client";
import { getSessionStore } from "@/lib/infrastructure/session/store";
import {
  OrchestratorAuthError,
  OrchestratorUnavailableError,
} from "@/lib/ports/orchestrator-client.port";

type LoginWindow = { count: number; startedAt: number };

/**
 * Process-local login limiter.
 * Keeps brute-force pressure low even when gateway-side limits are relaxed.
 */
const loginWindows = new Map<string, LoginWindow>();

function getClientKey(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) {
    return forwarded;
  }

  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

function isLoginRateLimited(
  request: NextRequest,
  maxAttemptsPerMinute: number,
): boolean {
  const key = getClientKey(request);
  const now = Date.now();
  const windowMs = 60_000;
  const current = loginWindows.get(key);

  if (!current || now - current.startedAt >= windowMs) {
    loginWindows.set(key, { count: 1, startedAt: now });
    return false;
  }

  if (current.count >= maxAttemptsPerMinute) {
    return true;
  }

  current.count += 1;
  loginWindows.set(key, current);
  return false;
}

/**
 * POST /api/auth/login
 *
 * Exchanges long-lived bearer token for short-lived server session id cookie.
 * Cookie stays httpOnly so browser JS never sees bearer material.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const config = env();

  if (isLoginRateLimited(request, config.MYBRAIN_WEB_RATE_LIMIT_LOGIN)) {
    return NextResponse.json(
      { success: false, error: "Too many login attempts" },
      { status: 429 },
    );
  }

  let payload: { token?: string };

  try {
    payload = (await request.json()) as { token?: string };
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON payload" },
      { status: 400 },
    );
  }

  const token = payload.token?.trim();
  if (!token) {
    return NextResponse.json(
      { success: false, error: "Token is required" },
      { status: 400 },
    );
  }

  const createClient = (bearerToken: string) =>
    new HttpOrchestratorClient(
      config.MYBRAIN_WEB_ORCHESTRATOR_URL,
      bearerToken,
      config.MYBRAIN_INTERNAL_API_KEY,
    );

  const useCase = new AuthenticateUseCase(createClient, getSessionStore());

  try {
    const sessionId = await useCase.authenticate(token);
    const response = NextResponse.json({ success: true });

    response.cookies.set("session", sessionId, {
      httpOnly: true,
      secure: config.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 2 * 60 * 60,
      path: "/",
    });

    return response;
  } catch (error) {
    if (error instanceof OrchestratorAuthError) {
      return NextResponse.json(
        { success: false, error: "Invalid or expired token" },
        { status: 401 },
      );
    }

    if (error instanceof OrchestratorUnavailableError) {
      return NextResponse.json(
        { success: false, error: "Orchestrator unavailable" },
        { status: 503 },
      );
    }

    return NextResponse.json(
      { success: false, error: "Authentication failed" },
      { status: 500 },
    );
  }
}
