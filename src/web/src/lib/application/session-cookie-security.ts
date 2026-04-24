/**
 * Inputs required to decide if session cookies must be marked as secure.
 */
export interface SessionCookieSecurityInput {
  readonly forwardedProtoHeader: string | null;
  readonly requestProtocol: string | null;
  readonly requestHost: string | null;
  readonly publicBaseUrl: string;
  readonly nodeEnv: "development" | "production" | "test";
}

/**
 * Detect loopback hosts where local HTTP is expected.
 */
function isLoopbackHost(host: string | null): boolean {
  if (!host) {
    return false;
  }

  let normalized = host.trim().toLowerCase();
  if (normalized.startsWith("[") && normalized.endsWith("]")) {
    normalized = normalized.slice(1, -1);
  }

  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1"
  );
}

/**
 * Decide whether session cookie should include Secure flag.
 *
 * Why this exists:
 * production mode alone is not enough in local Docker setups where traffic is
 * plain HTTP (localhost). In that case, Secure cookies are silently ignored by
 * browsers and auth loops forever. We prefer explicit transport signals first,
 * then fall back to configured public URL, and only then to NODE_ENV.
 */
export function shouldUseSecureSessionCookie(
  input: SessionCookieSecurityInput,
): boolean {
  // Browsers drop Secure cookies over plain HTTP loopback origins.
  // This hard guard prevents silent auth loops in local Docker/operator setups.
  if (isLoopbackHost(input.requestHost)) {
    return false;
  }

  let parsedPublicBaseUrl: URL | null = null;
  try {
    parsedPublicBaseUrl = new URL(input.publicBaseUrl);
    if (isLoopbackHost(parsedPublicBaseUrl.hostname)) {
      return false;
    }
  } catch {
    parsedPublicBaseUrl = null;
  }

  // Security invariant: production traffic on non-loopback hosts must keep
  // Secure enabled regardless of client-controlled forwarding headers.
  if (input.nodeEnv === "production") {
    return true;
  }

  const forwardedProto = input.forwardedProtoHeader
    ?.split(",")[0]
    ?.trim()
    .toLowerCase();
  if (forwardedProto === "https") {
    return true;
  }

  if (forwardedProto === "http") {
    return false;
  }

  const requestProtocol = input.requestProtocol?.trim().toLowerCase();
  if (requestProtocol === "https") {
    return true;
  }

  if (requestProtocol === "http") {
    return false;
  }

  if (parsedPublicBaseUrl) {
    return parsedPublicBaseUrl.protocol === "https:";
  }

  return false;
}
