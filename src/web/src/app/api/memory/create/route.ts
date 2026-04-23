import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedClient } from "@/lib/application/server-auth";

/**
 * POST /api/memory/create
 *
 * Server-side proxy for memory creation so bearer never reaches browser code.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
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
