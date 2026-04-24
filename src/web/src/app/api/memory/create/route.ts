import { NextRequest, NextResponse } from "next/server";
import {
  applyNoStoreHeaders,
  isMemoryRateLimited,
} from "@/lib/application/api-security";
import {
  getAuthenticatedClient,
  getSessionIdFromCookies,
  verifySessionCsrfToken,
} from "@/lib/composition/auth";

/**
 * POST /api/memory/create
 *
 * Server-side proxy for memory creation so bearer never reaches browser code.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const sessionId = await getSessionIdFromCookies();
  if (!sessionId) {
    return applyNoStoreHeaders(
      NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      ),
    );
  }

  const csrfToken = request.headers.get("x-csrf-token")?.trim();
  if (!csrfToken || !(await verifySessionCsrfToken(sessionId, csrfToken))) {
    return applyNoStoreHeaders(
      NextResponse.json(
        { success: false, error: "Invalid CSRF token" },
        { status: 403 },
      ),
    );
  }

  if (isMemoryRateLimited(request, sessionId)) {
    return applyNoStoreHeaders(
      NextResponse.json(
        { success: false, error: "Too many requests" },
        { status: 429 },
      ),
    );
  }

  const client = await getAuthenticatedClient();
  if (!client) {
    return applyNoStoreHeaders(
      NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      ),
    );
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
    return applyNoStoreHeaders(
      NextResponse.json(
        { success: false, error: "Invalid JSON payload" },
        { status: 400 },
      ),
    );
  }

  if (!payload.content || !payload.type || !payload.scope) {
    return applyNoStoreHeaders(
      NextResponse.json(
        { success: false, error: "content, type, and scope are required" },
        { status: 400 },
      ),
    );
  }

  try {
    const envelope = await client.createMemory(
      payload.content,
      payload.type,
      payload.scope,
      payload.metadata ?? {},
    );

    return applyNoStoreHeaders(
      NextResponse.json({
        success: true,
        summary: envelope.summary,
        data: envelope.data,
      }),
    );
  } catch (error) {
    return applyNoStoreHeaders(
      NextResponse.json(
        {
          success: false,
          error:
            error instanceof Error ? error.message : "Failed to create memory",
        },
        { status: 500 },
      ),
    );
  }
}
