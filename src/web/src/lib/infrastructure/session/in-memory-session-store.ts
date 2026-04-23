import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from "crypto";
import type { SessionStore } from "@/lib/ports/orchestrator-client.port";

/**
 * In-memory session store with encrypted bearer token storage.
 * Bearers are never in the cookie; they are stored server-side keyed by session ID.
 *
 * WARNING: This implementation is process-local memory only.
 * On container restart, all sessions are lost.
 * For persistent deployments, use Redis-backed session store (not in v1 scope).
 */
export class InMemorySessionStore implements SessionStore {
  private sessions: Map<
    string,
    { bearer: string; csrf: string; expiresAt: number }
  > = new Map();
  private readonly derivedKey: Buffer;

  constructor(private encryptionSecret: string) {
    if (encryptionSecret.trim().length < 16) {
      throw new Error("Encryption secret must be at least 16 characters");
    }

    // Derive fixed 256-bit key from caller-provided secret to avoid raw UTF-8 key material.
    this.derivedKey = scryptSync(this.encryptionSecret, "my-brain:web:session:v1", 32);
  }

  /**
   * Encrypt bearer token using AES-256-GCM with random IV + salt.
   */
  private encryptBearer(bearer: string): string {
    const iv = randomBytes(16);
    const cipher = createCipheriv("aes-256-gcm", this.derivedKey, iv);

    let encrypted = cipher.update(bearer, "utf-8", "hex");
    encrypted += cipher.final("hex");
    const authTag = cipher.getAuthTag();

    // Format: iv + authTag + encrypted (all hex)
    return [iv.toString("hex"), authTag.toString("hex"), encrypted].join(":");
  }

  /**
   * Decrypt bearer token.
   */
  private decryptBearer(encrypted: string): string | null {
    try {
      const parts = encrypted.split(":");
      if (parts.length !== 3) return null;

      const [ivHex, tagHex, cipherHex] = parts as [string, string, string];
      const iv = Buffer.from(ivHex, "hex");
      const authTag = Buffer.from(tagHex, "hex");

      const decipher = createDecipheriv("aes-256-gcm", this.derivedKey, iv);
      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(cipherHex, "hex", "utf-8");
      decrypted += decipher.final("utf-8");

      return decrypted;
    } catch {
      return null;
    }
  }

  async createSession(bearerToken: string, ttl = 2 * 60 * 60 * 1000): Promise<string> {
    const sessionId = randomBytes(16).toString("hex");
    const encryptedBearer = this.encryptBearer(bearerToken);
    const csrfToken = randomBytes(32).toString("hex");

    this.sessions.set(sessionId, {
      bearer: encryptedBearer,
      csrf: csrfToken,
      expiresAt: Date.now() + ttl,
    });

    return sessionId;
  }

  async getBearer(sessionId: string): Promise<string | null> {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return null;
    }

    if (Date.now() > session.expiresAt) {
      this.sessions.delete(sessionId);
      return null;
    }

    // Slide TTL on access (2h)
    session.expiresAt = Date.now() + 2 * 60 * 60 * 1000;

    const decrypted = this.decryptBearer(session.bearer);
    return decrypted;
  }

  async destroySession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  async verifyCSRFToken(sessionId: string, token: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);

    if (!session || Date.now() > session.expiresAt) {
      return false;
    }

    return session.csrf === token;
  }

  async getCSRFToken(sessionId: string): Promise<string> {
    const session = this.sessions.get(sessionId);

    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    return session.csrf;
  }
}
