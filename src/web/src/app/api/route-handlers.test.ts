import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const authMocks = {
  getSessionIdFromCookies: vi.fn(),
  verifySessionCsrfToken: vi.fn(),
  getAuthenticatedClient: vi.fn(),
  destroySession: vi.fn(),
};

const securityMocks = {
  isMemoryRateLimited: vi.fn(() => false),
  applyNoStoreHeaders: vi.fn((response: Response) => response),
};

vi.mock("@/lib/composition/auth", () => authMocks);
vi.mock("@/lib/application/api-security", () => securityMocks);

beforeEach(() => {
  vi.clearAllMocks();
});

function createPostRequest(
  url: string,
  body: string,
  csrfToken?: string,
): NextRequest {
  const headers = new Headers({ "content-type": "application/json" });
  if (csrfToken) {
    headers.set("x-csrf-token", csrfToken);
  }

  return new NextRequest(url, {
    method: "POST",
    body,
    headers,
  });
}

describe("POST /api/memory/query", () => {
  it("returns 401 when session is missing", async () => {
    authMocks.getSessionIdFromCookies.mockResolvedValue(null);

    const { POST } = await import("@/app/api/memory/query/route");
    const response = await POST(
      createPostRequest("http://localhost/api/memory/query", "{}"),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: "Unauthorized",
    });
  });

  it("returns 403 on csrf mismatch", async () => {
    authMocks.getSessionIdFromCookies.mockResolvedValue("s1");
    authMocks.verifySessionCsrfToken.mockResolvedValue(false);

    const { POST } = await import("@/app/api/memory/query/route");
    const response = await POST(
      createPostRequest("http://localhost/api/memory/query", "{}", "bad-token"),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: "Invalid CSRF token",
    });
  });

  it("returns 503 response envelope when downstream fails", async () => {
    authMocks.getSessionIdFromCookies.mockResolvedValue("s1");
    authMocks.verifySessionCsrfToken.mockResolvedValue(true);
    authMocks.getAuthenticatedClient.mockResolvedValue({
      recall: vi.fn(async () => {
        throw new Error("orchestrator unavailable");
      }),
      digest: vi.fn(),
    });

    const { POST } = await import("@/app/api/memory/query/route");
    const response = await POST(
      createPostRequest(
        "http://localhost/api/memory/query",
        JSON.stringify({ tool: "mb_recall", params: { query: "hello" } }),
        "csrf",
      ),
    );

    expect(response.status).toBe(500);
    const payload = (await response.json()) as {
      success: boolean;
      error?: string;
    };
    expect(payload.success).toBe(false);
    expect(payload.error).toContain("orchestrator unavailable");
  });

  it("passes processed mode and pinned model to orchestrator recall", async () => {
    const recall = vi.fn(async () => ({ success: true }));
    authMocks.getSessionIdFromCookies.mockResolvedValue("s1");
    authMocks.verifySessionCsrfToken.mockResolvedValue(true);
    authMocks.getAuthenticatedClient.mockResolvedValue({
      recall,
      digest: vi.fn(),
    });

    const { POST } = await import("@/app/api/memory/query/route");
    const response = await POST(
      createPostRequest(
        "http://localhost/api/memory/query",
        JSON.stringify({
          tool: "mb_recall",
          params: {
            query: "hello",
            mode: "processed",
            model: "qwen3.5:0.8b",
          },
        }),
        "csrf",
      ),
    );

    expect(response.status).toBe(200);
    expect(recall).toHaveBeenCalledWith(
      "hello",
      undefined,
      "processed",
      "qwen3.5:0.8b",
    );
  });
});

describe("POST /api/auth/logout", () => {
  it("returns 401 when session is missing", async () => {
    authMocks.getSessionIdFromCookies.mockResolvedValue(null);

    const { POST } = await import("@/app/api/auth/logout/route");
    const response = await POST(
      createPostRequest("http://localhost/api/auth/logout", "{}", "csrf"),
    );

    expect(response.status).toBe(401);
  });

  it("returns 403 when csrf token is invalid", async () => {
    authMocks.getSessionIdFromCookies.mockResolvedValue("s1");
    authMocks.verifySessionCsrfToken.mockResolvedValue(false);

    const { POST } = await import("@/app/api/auth/logout/route");
    const response = await POST(
      createPostRequest("http://localhost/api/auth/logout", "{}", "csrf"),
    );

    expect(response.status).toBe(403);
  });

  it("destroys session and clears cookie on success", async () => {
    authMocks.getSessionIdFromCookies.mockResolvedValue("s1");
    authMocks.verifySessionCsrfToken.mockResolvedValue(true);

    const { POST } = await import("@/app/api/auth/logout/route");
    const response = await POST(
      createPostRequest("http://localhost/api/auth/logout", "{}", "csrf"),
    );

    expect(response.status).toBe(200);
    expect(authMocks.destroySession).toHaveBeenCalledWith("s1");
  });
});

describe("Cache-Control: no-store on auth-sensitive routes", () => {
  it("applies no-store to query route on unauthenticated response", async () => {
    authMocks.getSessionIdFromCookies.mockResolvedValue(null);

    const { POST } = await import("@/app/api/memory/query/route");
    await POST(createPostRequest("http://localhost/api/memory/query", "{}"));

    // applyNoStoreHeaders must be called for every path — including early exits.
    expect(securityMocks.applyNoStoreHeaders).toHaveBeenCalled();
  });

  it("applies no-store to create route on unauthenticated response", async () => {
    authMocks.getSessionIdFromCookies.mockResolvedValue(null);

    const { POST } = await import("@/app/api/memory/create/route");
    await POST(createPostRequest("http://localhost/api/memory/create", "{}"));

    expect(securityMocks.applyNoStoreHeaders).toHaveBeenCalled();
  });

  it("applies no-store to forget route on unauthenticated response", async () => {
    authMocks.getSessionIdFromCookies.mockResolvedValue(null);

    const { POST } = await import("@/app/api/memory/forget/route");
    await POST(createPostRequest("http://localhost/api/memory/forget", "{}"));

    expect(securityMocks.applyNoStoreHeaders).toHaveBeenCalled();
  });
});
