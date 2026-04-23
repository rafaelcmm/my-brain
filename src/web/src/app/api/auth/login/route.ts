import { NextRequest, NextResponse } from "next/server";
import { applyNoStoreHeaders, isLoginRateLimited } from "@/lib/application/api-security";
import { AuthenticateUseCase } from "@/lib/application/authenticate.usecase";
import { env } from "@/lib/config/env";
import { HttpOrchestratorClient } from "@/lib/infrastructure/orchestrator/http-orchestrator-client";
import { getSessionStore } from "@/lib/infrastructure/session/store";
import {
  OrchestratorAuthError,
  OrchestratorUnavailableError,
} from "@/lib/ports/orchestrator-client.port";

/**
 * POST /api/auth/login
 *
 * Exchanges long-lived bearer token for short-lived server session id cookie.
 * Cookie stays httpOnly so browser JS never sees bearer material.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const config = env();

  if (isLoginRateLimited(request, config.MYBRAIN_WEB_RATE_LIMIT_LOGIN)) {
    return applyNoStoreHeaders(NextResponse.json(
      { success: false, error: "Too many login attempts" },
      { status: 429 },
    ));
  }

  let payload: { token?: string };

  try {
    payload = (await request.json()) as { token?: string };
  } catch {
    return applyNoStoreHeaders(NextResponse.json(
      { success: false, error: "Invalid JSON payload" },
      { status: 400 },
    ));
  }

  const token = payload.token?.trim();
  if (!token) {
    return applyNoStoreHeaders(NextResponse.json(
      { success: false, error: "Token is required" },
      { status: 400 },
    ));
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
    const response = applyNoStoreHeaders(NextResponse.json({ success: true }));

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
      return applyNoStoreHeaders(NextResponse.json(
        { success: false, error: "Invalid or expired token" },
        { status: 401 },
      ));
    }

    if (error instanceof OrchestratorUnavailableError) {
      return applyNoStoreHeaders(NextResponse.json(
        { success: false, error: "Orchestrator unavailable" },
        { status: 503 },
      ));
    }

    return applyNoStoreHeaders(NextResponse.json(
      { success: false, error: "Authentication failed" },
      { status: 500 },
    ));
  }
}
