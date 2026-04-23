import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isMemoryRateLimited } from "@/lib/application/api-security";
import { getAuthenticatedClient } from "@/lib/application/server-auth";
import { getSessionStore } from "@/lib/infrastructure/session/store";

/**
 * POST /api/memory/query
 * Executes recall or digest through authenticated server proxy.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get("session")?.value;
  if (!sessionId) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const csrfToken = request.headers.get("x-csrf-token")?.trim();
  if (!csrfToken || !(await getSessionStore().verifyCSRFToken(sessionId, csrfToken))) {
    return NextResponse.json({ success: false, error: "Invalid CSRF token" }, { status: 403 });
  }

  if (isMemoryRateLimited(request, sessionId)) {
    return NextResponse.json(
      { success: false, error: "Too many requests" },
      { status: 429 },
    );
  }

  const client = await getAuthenticatedClient();
  if (!client) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  let payload: {
    tool?: "recall" | "digest";
    query?: string;
    scope?: string;
    type?: string;
  };

  try {
    payload = (await request.json()) as {
      tool?: "recall" | "digest";
      query?: string;
      scope?: string;
      type?: string;
    };
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON payload" }, { status: 400 });
  }

  try {
    if (payload.tool === "digest") {
      const result = await client.digest(payload.scope, payload.type);
      return NextResponse.json({ success: true, data: result });
    }

    if (!payload.query?.trim()) {
      return NextResponse.json(
        { success: false, error: "query is required for recall" },
        { status: 400 },
      );
    }

    const result = await client.recall(payload.query, payload.scope);
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Query failed",
      },
      { status: 500 },
    );
  }
}
