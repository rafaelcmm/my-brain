import { NextRequest, NextResponse } from "next/server";
import { applyNoStoreHeaders } from "@/lib/application/api-security";
import { shouldUseSecureSessionCookie } from "@/lib/application/session-cookie-security";
import {
  destroySession,
  getSessionIdFromCookies,
  verifySessionCsrfToken,
} from "@/lib/composition/auth";

/**
 * POST /api/auth/logout
 * Clear authenticated session when CSRF token matches active session.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const sessionId = await getSessionIdFromCookies();
  const csrfToken = request.headers.get("x-csrf-token")?.trim();

  if (!sessionId) {
    return applyNoStoreHeaders(
      NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      ),
    );
  }

  if (!csrfToken || !(await verifySessionCsrfToken(sessionId, csrfToken))) {
    return applyNoStoreHeaders(
      NextResponse.json(
        { success: false, error: "Invalid CSRF token" },
        { status: 403 },
      ),
    );
  }

  await destroySession(sessionId);

  const response = applyNoStoreHeaders(NextResponse.json({ success: true }));
  const secureCookie = shouldUseSecureSessionCookie({
    forwardedProtoHeader: request.headers.get("x-forwarded-proto"),
    requestProtocol: request.nextUrl.protocol.replace(":", ""),
    requestHost: request.nextUrl.hostname,
    publicBaseUrl:
      process.env.MYBRAIN_WEB_PUBLIC_BASE_URL ?? request.nextUrl.origin,
    nodeEnv:
      process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test"
        ? process.env.NODE_ENV
        : "production",
  });

  // Clear session cookie
  response.cookies.set("session", "", {
    httpOnly: true,
    secure: secureCookie,
    sameSite: "strict",
    maxAge: 0,
    path: "/",
  });

  return response;
}
