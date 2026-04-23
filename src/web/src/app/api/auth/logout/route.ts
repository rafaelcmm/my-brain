import { NextResponse } from "next/server";

/**
 * POST /api/auth/logout
 * Clear session cookie.
 * Response: { success: boolean }
 */
export async function POST() {
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
