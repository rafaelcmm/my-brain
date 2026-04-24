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
 * POST /api/memory/forget
 * Soft-delete selected memory id.
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

  let payload: { id?: string };
  try {
    payload = (await request.json()) as { id?: string };
  } catch {
    return applyNoStoreHeaders(
      NextResponse.json(
        { success: false, error: "Invalid JSON payload" },
        { status: 400 },
      ),
    );
  }

  if (!payload.id) {
    return applyNoStoreHeaders(
      NextResponse.json(
        { success: false, error: "id is required" },
        { status: 400 },
      ),
    );
  }

  try {
    await client.forgetMemory(payload.id);
    return applyNoStoreHeaders(NextResponse.json({ success: true }));
  } catch (error) {
    return applyNoStoreHeaders(
      NextResponse.json(
        {
          success: false,
          error:
            error instanceof Error ? error.message : "Failed to forget memory",
        },
        { status: 500 },
      ),
    );
  }
}
