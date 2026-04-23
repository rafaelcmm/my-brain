import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedClient } from "@/lib/application/server-auth";

/**
 * POST /api/memory/query
 * Executes recall or digest through authenticated server proxy.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
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
