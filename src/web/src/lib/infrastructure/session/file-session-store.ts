import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  scryptSync,
  timingSafeEqual,
} from "crypto";
import {
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
  chmod,
} from "fs/promises";
import { dirname } from "path";
import type { SessionStore } from "@/lib/ports/orchestrator-client.port";

interface SessionRecord {
  readonly bearer: string;
  readonly csrf: string;
  readonly expiresAt: number;
}

type SessionFileData = Record<string, SessionRecord>;

/**
 * Shared session store persisted on local filesystem.
 *
 * Why this exists:
 * Next.js route handlers and server components may execute in different
 * runtimes/processes. In-memory maps can diverge and make valid cookies look
 * unauthenticated. Persisting encrypted session records to disk keeps both
 * runtimes consistent while preserving bearer server-side.
 */
export class FileSessionStore implements SessionStore {
  private readonly derivedKey: Buffer;
  private readonly lockPath: string;

  constructor(
    private readonly encryptionSecret: string,
    private readonly storagePath = "/tmp/my-brain-web-sessions.json",
  ) {
    if (encryptionSecret.trim().length < 16) {
      throw new Error("Encryption secret must be at least 16 characters");
    }

    this.derivedKey = scryptSync(
      this.encryptionSecret,
      "my-brain:web:session:v1",
      32,
    );
    this.lockPath = `${this.storagePath}.lock`;
  }

  /**
   * Acquire lock around read-modify-write operations shared by multiple runtimes.
   */
  private async withExclusiveLock<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    const maxAttempts = 40;
    const retryDelayMs = 25;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        await writeFile(this.lockPath, String(process.pid), {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600,
        });

        try {
          return await operation();
        } finally {
          await unlink(this.lockPath).catch(() => undefined);
        }
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "EEXIST") {
          throw error;
        }

        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }

    throw new Error("Session store lock timeout");
  }

  /**
   * Encrypt bearer token using AES-256-GCM with random IV + auth tag.
   */
  private encryptBearer(bearer: string): string {
    const iv = randomBytes(16);
    const cipher = createCipheriv("aes-256-gcm", this.derivedKey, iv);

    let encrypted = cipher.update(bearer, "utf-8", "hex");
    encrypted += cipher.final("hex");
    const authTag = cipher.getAuthTag();

    return [iv.toString("hex"), authTag.toString("hex"), encrypted].join(":");
  }

  /**
   * Decrypt bearer token from persisted encrypted payload.
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

  /**
   * Load persisted sessions from disk.
   */
  private async readSessions(): Promise<Map<string, SessionRecord>> {
    try {
      const raw = await readFile(this.storagePath, "utf8");
      if (!raw.trim()) {
        return new Map();
      }

      let parsed: SessionFileData;
      try {
        parsed = JSON.parse(raw) as SessionFileData;
      } catch {
        const corruptPath = `${this.storagePath}.corrupt-${Date.now()}`;
        await rename(this.storagePath, corruptPath).catch(() => undefined);
        return new Map();
      }

      return new Map(Object.entries(parsed));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return new Map();
      }

      throw error;
    }
  }

  /**
   * Persist sessions atomically to disk so parallel runtimes see consistent data.
   */
  private async writeSessions(sessions: Map<string, SessionRecord>): Promise<void> {
    await mkdir(dirname(this.storagePath), { recursive: true, mode: 0o700 });

    const payload = JSON.stringify(Object.fromEntries(sessions), null, 0);
    const tempPath = `${this.storagePath}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
    await writeFile(tempPath, payload, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(tempPath, this.storagePath);
    await chmod(this.storagePath, 0o600);
  }

  /**
   * Remove expired sessions from map in-memory representation.
   */
  private pruneExpired(sessions: Map<string, SessionRecord>, now: number): void {
    for (const [id, session] of sessions.entries()) {
      if (now > session.expiresAt) {
        sessions.delete(id);
      }
    }
  }

  async createSession(
    bearerToken: string,
    ttl = 2 * 60 * 60 * 1000,
  ): Promise<string> {
    return this.withExclusiveLock(async () => {
      const sessions = await this.readSessions();
      const now = Date.now();
      this.pruneExpired(sessions, now);

      const sessionId = randomBytes(16).toString("hex");
      sessions.set(sessionId, {
        bearer: this.encryptBearer(bearerToken),
        csrf: randomBytes(32).toString("hex"),
        expiresAt: now + ttl,
      });

      await this.writeSessions(sessions);
      return sessionId;
    });
  }

  async getBearer(sessionId: string): Promise<string | null> {
    return this.withExclusiveLock(async () => {
      const sessions = await this.readSessions();
      const now = Date.now();
      const session = sessions.get(sessionId);

      if (!session || now > session.expiresAt) {
        if (session) {
          sessions.delete(sessionId);
          await this.writeSessions(sessions);
        }
        return null;
      }

      // Slide TTL on access (2h)
      sessions.set(sessionId, {
        ...session,
        expiresAt: now + 2 * 60 * 60 * 1000,
      });
      await this.writeSessions(sessions);

      return this.decryptBearer(session.bearer);
    });
  }

  async destroySession(sessionId: string): Promise<void> {
    await this.withExclusiveLock(async () => {
      const sessions = await this.readSessions();
      sessions.delete(sessionId);
      await this.writeSessions(sessions);
    });
  }

  async verifyCSRFToken(sessionId: string, token: string): Promise<boolean> {
    const sessions = await this.readSessions();
    const now = Date.now();
    const session = sessions.get(sessionId);

    if (!session || now > session.expiresAt) {
      return false;
    }

    const expected = Buffer.from(session.csrf, "utf8");
    const received = Buffer.from(token, "utf8");
    if (expected.length !== received.length) {
      return false;
    }

    return timingSafeEqual(expected, received);
  }

  async getCSRFToken(sessionId: string): Promise<string> {
    const sessions = await this.readSessions();
    const session = sessions.get(sessionId);

    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    return session.csrf;
  }
}
