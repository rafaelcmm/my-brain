import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedClient } from "@/lib/application/server-auth";

/**
 * POST /api/memory/forget
 * Soft-delete selected memory id.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const client = await getAuthenticatedClient();
  if (!client) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  let payload: { id?: string };
  try {
    payload = (await request.json()) as { id?: string };
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON payload" }, { status: 400 });
  }

  if (!payload.id) {
    return NextResponse.json({ success: false, error: "id is required" }, { status: 400 });
  }

  try {
    await client.forgetMemory(payload.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to forget memory",
      },
      { status: 500 },
    );
  }
}
