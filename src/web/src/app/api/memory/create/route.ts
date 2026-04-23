import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isMemoryRateLimited } from "@/lib/application/api-security";
import { getAuthenticatedClient } from "@/lib/application/server-auth";
import { getSessionStore } from "@/lib/infrastructure/session/store";

/**
 * POST /api/memory/create
 *
 * Server-side proxy for memory creation so bearer never reaches browser code.
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
    content?: string;
    type?: string;
    scope?: string;
    metadata?: Record<string, unknown>;
  };

  try {
    payload = (await request.json()) as {
      content?: string;
      type?: string;
      scope?: string;
      metadata?: Record<string, unknown>;
    };
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON payload" },
      { status: 400 },
    );
  }

  if (!payload.content || !payload.type || !payload.scope) {
    return NextResponse.json(
      { success: false, error: "content, type, and scope are required" },
      { status: 400 },
    );
  }

  try {
    const response = await client.createMemory(
      payload.content,
      payload.type,
      payload.scope,
      payload.metadata ?? {},
    );

    return NextResponse.json({ success: true, data: response });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to create memory",
      },
      { status: 500 },
    );
  }
}
