import { NextRequest, NextResponse } from "next/server";
import {
  applyNoStoreHeaders,
  isMemoryRateLimited,
} from "@/lib/application/api-security";
import { RunQueryUseCase } from "@/lib/application/run-query.usecase";
import type { QueryRequest } from "@/lib/domain";
import {
  getAuthenticatedClient,
  getSessionIdFromCookies,
  verifySessionCsrfToken,
} from "@/lib/composition/auth";

/**
 * POST /api/memory/query
 * Executes recall or digest through authenticated server proxy.
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

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return applyNoStoreHeaders(
      NextResponse.json(
        { success: false, error: "Invalid JSON payload" },
        { status: 400 },
      ),
    );
  }

  const normalizedRequest = normalizeQueryRequest(payload);
  if (normalizedRequest.errorMessage) {
    return applyNoStoreHeaders(
      NextResponse.json(
        {
          success: false,
          error: normalizedRequest.errorMessage,
        },
        { status: 400 },
      ),
    );
  }

  const useCase = new RunQueryUseCase(client);
  const result = await useCase.execute(normalizedRequest.request);
  return applyNoStoreHeaders(
    NextResponse.json(
      {
        success: result.status < 400,
        ...result,
      },
      { status: result.status },
    ),
  );
}

function normalizeQueryRequest(payload: unknown): {
  request: QueryRequest;
  errorMessage: string | null;
} {
  if (!payload || typeof payload !== "object") {
    return {
      request: { tool: "mb_recall", params: {} },
      errorMessage: null,
    };
  }

  const record = payload as Record<string, unknown>;
  const hasDeprecatedParams =
    record["mode"] !== undefined ||
    record["model"] !== undefined ||
    (typeof record["params"] === "object" &&
      record["params"] !== null &&
      ((record["params"] as Record<string, unknown>)["mode"] !== undefined ||
        (record["params"] as Record<string, unknown>)["model"] !== undefined));
  const tool = record["tool"];
  const toolText = typeof tool === "string" ? tool.trim() : "";

  if (
    toolText &&
    toolText !== "mb_recall" &&
    toolText !== "mb_digest" &&
    toolText !== "digest" &&
    toolText !== "recall"
  ) {
    return {
      request: { tool: "mb_recall", params: {} },
      errorMessage: "unsupported tool for v2 query route",
    };
  }

  if (
    (tool === "mb_recall" || tool === "mb_digest") &&
    record.params &&
    typeof record.params === "object"
  ) {
    return {
      request: {
        tool,
        params: record.params as Record<string, unknown>,
      },
      errorMessage: hasDeprecatedParams
        ? "mode/model are no longer supported in v2"
        : null,
    };
  }

  const legacyTool = tool === "digest" ? "mb_digest" : "mb_recall";
  return {
    request: {
      tool: legacyTool,
      params: {
        query: record.query,
        scope: record.scope,
        type: record.type,
      },
    },
    errorMessage: hasDeprecatedParams
      ? "mode/model are no longer supported in v2"
      : null,
  };
}
