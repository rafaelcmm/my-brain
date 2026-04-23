import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { applyNoStoreHeaders } from "@/lib/application/api-security";
import { getSessionStore } from "@/lib/infrastructure/session/store";

/**
 * POST /api/auth/logout
 * Clear authenticated session when CSRF token matches active session.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get("session")?.value;
  const csrfToken = request.headers.get("x-csrf-token")?.trim();

  if (!sessionId) {
    return applyNoStoreHeaders(
      NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 }),
    );
  }

  if (!csrfToken || !(await getSessionStore().verifyCSRFToken(sessionId, csrfToken))) {
    return applyNoStoreHeaders(
      NextResponse.json({ success: false, error: "Invalid CSRF token" }, { status: 403 }),
    );
  }

  if (sessionId) {
    await getSessionStore().destroySession(sessionId);
  }

  const response = applyNoStoreHeaders(NextResponse.json({ success: true }));

  // Clear session cookie
  response.cookies.set("session", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 0,
    path: "/",
  });

  return response;
}
