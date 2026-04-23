/**
 * Utility for making typed HTTP requests with proper error handling.
 * Used internally by adapters; not exposed to application layer.
 */

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  headers?: Record<string, string>;
  body?: unknown;
}

export interface ResponseStatus {
  ok: boolean;
  status: number;
}

/**
 * Make a fetch request and parse JSON response.
 * Automatically stringifies body if provided.
 * @throws TypeError on network errors
 * @throws SyntaxError on invalid JSON response
 */
export async function makeRequest(
  url: string,
  options: RequestOptions = {},
): Promise<{ status: number; data: unknown }> {
  const {
    method = "GET" as const,
    headers = {},
    body,
  } = options;

  const config: RequestInit = {
    method,
    headers,
  };

  if (body !== undefined) {
    config.body = typeof body === "string" ? body : JSON.stringify(body);
    config.headers = {
      ...headers,
      "Content-Type": "application/json",
    };
  }

  const response = await fetch(url, config);
  const text = await response.text();

  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  return { status: response.status, data };
}
