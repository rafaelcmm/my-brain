import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSessionStore } from "@/lib/infrastructure/session/store";

/**
 * POST /api/auth/logout
 * Clear session cookie.
 * Response: { success: boolean }
 */
export async function POST() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get("session")?.value;
  if (sessionId) {
    await getSessionStore().destroySession(sessionId);
  }

  const response = NextResponse.json({ success: true });

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
