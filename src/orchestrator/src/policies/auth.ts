/**
 * Auth token validation policy for the orchestrator runtime.
 *
 * Responsibilities:
 * - Enforce a minimum token length so weak secrets are rejected at startup.
 * - Validate the `my-brain-` prefix that scopes tokens to this service.
 * - Support the MYBRAIN_ALLOW_GATEWAY_ONLY_AUTH escape hatch for deployments
 *   where the orchestrator process cannot read the secret file directly (e.g.
 *   non-root user with a Caddy gateway that already enforces auth).
 * - Perform timing-safe internal API key comparison to resist timing attacks.
 */

import { timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import type { IncomingMessage } from "node:http";
import { parseBoolean, parseInteger } from "../config/load-config.js";
import { pushDegradedReason } from "../observability/log.js";

/**
 * Minimum acceptable token length (in characters after trim).
 *
 * Derived from the environment variable MYBRAIN_MIN_TOKEN_LENGTH so operators
 * can tighten the policy without a code change. Default of 73 was chosen to
 * ensure tokens carry sufficient entropy for the service's threat model.
 */
export const MIN_TOKEN_LENGTH: number = parseInteger(
  process.env.MYBRAIN_MIN_TOKEN_LENGTH,
  73,
);

/**
 * Subset of orchestrator config consumed by auth policy.
 *
 * Using a structural interface rather than importing the full Config type keeps
 * this module independent from config internals and easier to test in isolation.
 */
export interface AuthConfig {
  /** Filesystem path to the bearer token secret file. */
  readonly tokenFile: string;
  /** Shared key used by trusted internal callers (mcp-bridge). */
  readonly internalApiKey: string;
}

/**
 * Validates that the auth token file exists, is readable, meets length
 * requirements, and carries the expected service-scoped prefix.
 *
 * Side effects: appends degradation reasons to `reasons` on any failure.
 * Does not throw; all failure paths return `false` and record a reason.
 *
 * EACCES handling: when the orchestrator user cannot read the token file but
 * `MYBRAIN_ALLOW_GATEWAY_ONLY_AUTH=true` is set, the function trusts that the
 * upstream Caddy gateway enforces auth and returns `true`. Default is `false`
 * (closed) so a misconfigured mount never silently opens an unauthenticated path.
 *
 * @param config - Auth-relevant fields from orchestrator config.
 * @param reasons - Mutable array of degraded reason strings from runtime state.
 * @returns `true` when token is validated; `false` on any policy failure.
 */
export function validateAuthToken(
  config: AuthConfig,
  reasons: string[],
): boolean {
  if (!fs.existsSync(config.tokenFile)) {
    pushDegradedReason(reasons, "auth token file missing for orchestrator");
    return false;
  }

  let token: string;
  try {
    token = fs.readFileSync(config.tokenFile, "utf8").trim();
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code: unknown }).code)
        : "";

    if (code === "EACCES") {
      // EACCES means the token file exists but the orchestrator's non-root user
      // cannot read it (mode 0444/0600 with a different owner). When
      // MYBRAIN_ALLOW_GATEWAY_ONLY_AUTH=true the operator explicitly asserts
      // that the Caddy gateway is the sole auth enforcement point and leaked
      // token access is not a concern. Default is false-closed so a
      // misconfigured mount does not silently open an unauthenticated path.
      const gatewayOnlyAuth = parseBoolean(
        process.env.MYBRAIN_ALLOW_GATEWAY_ONLY_AUTH,
        false,
      );
      if (gatewayOnlyAuth) {
        process.stdout.write(
          "[my-brain] auth token file not readable by orchestrator user; MYBRAIN_ALLOW_GATEWAY_ONLY_AUTH=true — relying on gateway auth enforcement\n",
        );
        return true;
      }
      pushDegradedReason(
        reasons,
        "auth token file not readable by orchestrator user; set MYBRAIN_ALLOW_GATEWAY_ONLY_AUTH=true to allow gateway-only auth",
      );
      return false;
    }

    pushDegradedReason(
      reasons,
      "auth token unreadable by orchestrator runtime",
    );
    return false;
  }

  if (token.length < MIN_TOKEN_LENGTH) {
    pushDegradedReason(reasons, "auth token length below policy");
    return false;
  }

  if (!token.startsWith("my-brain-")) {
    pushDegradedReason(reasons, "auth token prefix invalid");
    return false;
  }

  process.stdout.write(
    `[my-brain] auth token validated (${token.length} chars)\n`,
  );
  return true;
}

/**
 * Validates the `x-mybrain-internal-key` header against the configured shared
 * secret using a timing-safe comparison.
 *
 * Timing-safe equality is mandatory here: a naive `===` comparison leaks key
 * length through early-exit behavior, which is exploitable via timing oracle
 * on a local network.
 *
 * Length mismatch is checked before `timingSafeEqual` because that function
 * requires equal-length buffers; returning false early on mismatched lengths
 * does not introduce a timing oracle (the mismatch is not secret).
 *
 * @param req - Incoming HTTP request whose headers are inspected.
 * @param internalApiKey - Expected API key from orchestrator config.
 * @returns `true` when the request carries the correct internal key.
 */
export function hasValidInternalKey(
  req: IncomingMessage,
  internalApiKey: string,
): boolean {
  if (!internalApiKey) {
    return false;
  }

  const header = req.headers["x-mybrain-internal-key"];
  const provided = Array.isArray(header) ? header[0] : header;
  if (typeof provided !== "string") {
    return false;
  }

  const expected = Buffer.from(internalApiKey, "utf8");
  const actual = Buffer.from(provided, "utf8");
  if (expected.length !== actual.length) {
    return false;
  }

  return timingSafeEqual(expected, actual);
}
