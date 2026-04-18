/**
 * AuthTokenPort defines security boundary contract for issuing, persisting,
 * and validating bearer tokens used by HTTP MCP transport.
 */
export interface AuthTokenPort {
  /**
   * Guarantees at least one active token exists before serving HTTP traffic.
   *
   * @param bootstrapToken Optional seed token used only when storage has no
   * active token yet. Caller should pass an operator-provided secret.
   * @throws Error when persisted token storage cannot be read or updated.
   */
  ensureActiveToken(bootstrapToken?: string): void;

  /**
   * Validates bearer token against active persisted credentials.
   *
   * @param token Raw bearer token from Authorization header.
   * @returns True only when token matches a non-revoked, non-expired persisted token.
   * @throws Error when persisted token storage is unreadable or invalid.
   */
  verifyToken(token: string): boolean;

  /**
   * Issues new active token and persists only irreversible hash material.
   *
   * @param label Human-readable context to support operational audits.
   * @param ttlDays Optional expiration in days. Undefined means non-expiring token.
   * @returns Newly issued token secret and token id for future revocation.
   * @throws Error when persistence fails or token storage format is invalid.
   */
  issueToken(label: string, ttlDays?: number): { tokenId: string; token: string };

  /**
   * Revokes token by identifier to immediately block future authorization.
   *
   * @param tokenId Persisted token identifier.
   * @returns True when token existed and became revoked.
   * @throws Error when persistence fails or token storage format is invalid.
   */
  revokeToken(tokenId: string): boolean;
}
