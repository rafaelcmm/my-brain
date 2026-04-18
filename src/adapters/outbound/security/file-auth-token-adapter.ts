import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AuthTokenPort } from '../../../core/ports/auth-token-port.js';

const TOKEN_LENGTH_BYTES = 32;
const TOKEN_MIN_LENGTH = 32;
const HASH_LENGTH_BYTES = 64;
const VERIFICATION_CACHE_TTL_MS = 3_000;
const ACTIVE_TOKEN_REFRESH_MS = 2_000;
const VERIFICATION_CACHE_MAX_ENTRIES = 5_000;

/**
 * PersistedTokenRecord stores irreversible token material and lifecycle metadata
 * required for verification, expiration, and operational revocation.
 */
interface PersistedTokenRecord {
  readonly id: string;
  readonly label: string;
  readonly saltHex: string;
  readonly hashHex: string;
  readonly createdAtIso: string;
  readonly expiresAtIso?: string;
  readonly revokedAtIso?: string;
}

/**
 * PersistedTokenStore is versioned to support forward-compatible on-disk
 * migrations if token metadata schema evolves in future releases.
 */
interface PersistedTokenStore {
  readonly version: 1;
  readonly tokens: PersistedTokenRecord[];
}

/**
 * VerificationCacheEntry keeps short-lived auth decisions to avoid repeated
 * expensive KDF work under burst traffic while bounding stale-auth windows.
 */
interface VerificationCacheEntry {
  readonly isValid: boolean;
  readonly expiresAtEpochMs: number;
}

/**
 * FileAuthTokenAdapter persists hashed bearer tokens on disk so HTTP auth
 * survives restarts without storing plaintext secrets.
 */
export class FileAuthTokenAdapter implements AuthTokenPort {
  private readonly verificationCache = new Map<string, VerificationCacheEntry>();
  private cachedActiveTokens: PersistedTokenRecord[] = [];
  private lastActiveTokenRefreshEpochMs = 0;

  /**
   * @param storePath Absolute path of JSON token store persisted on disk.
   */
  public constructor(private readonly storePath: string) {}

  /**
   * Ensures at least one active token exists before server accepts requests.
   */
  public ensureActiveToken(bootstrapToken?: string): void {
    const store = this.loadStore();
    const activeTokens = this.getActiveTokens(store);
    if (activeTokens.length > 0) {
      this.cachedActiveTokens = activeTokens;
      this.lastActiveTokenRefreshEpochMs = Date.now();
      return;
    }

    if (bootstrapToken) {
      this.appendTokenRecord(store, bootstrapToken, 'bootstrap');
      this.saveStore(store);
      this.refreshActiveTokens();
      return;
    }

    throw new Error(
      'No active MCP auth token found. Initialize with node dist/cli/manage-auth-token.js init --bootstrap-token <secure-token>.',
    );
  }

  /**
   * Verifies token against persisted active token records.
   */
  public verifyToken(token: string): boolean {
    if (token.trim().length < TOKEN_MIN_LENGTH) {
      return false;
    }

    const now = Date.now();
    const cacheHit = this.verificationCache.get(token);
    if (cacheHit && cacheHit.expiresAtEpochMs > now) {
      return cacheHit.isValid;
    }

    const activeTokens = this.getActiveTokensSnapshot();
    const isValid = activeTokens.some((record) =>
      this.matchTokenRecord(token, record.saltHex, record.hashHex),
    );

    if (this.verificationCache.size >= VERIFICATION_CACHE_MAX_ENTRIES) {
      const oldestKey = this.verificationCache.keys().next().value;
      if (typeof oldestKey === 'string') {
        this.verificationCache.delete(oldestKey);
      }
    }

    this.verificationCache.set(token, {
      isValid,
      expiresAtEpochMs: now + VERIFICATION_CACHE_TTL_MS,
    });

    return isValid;
  }

  /**
   * Issues and persists new token while returning plaintext to caller once.
   */
  public issueToken(label: string, ttlDays?: number): { tokenId: string; token: string } {
    const token = randomBytes(TOKEN_LENGTH_BYTES).toString('hex');
    const store = this.loadStore();
    const tokenId = this.appendTokenRecord(store, token, label, ttlDays);
    this.saveStore(store);
    this.refreshActiveTokens();
    this.verificationCache.clear();
    return { tokenId, token };
  }

  /**
   * Revokes token identifier and persists mutation for immediate enforcement.
   */
  public revokeToken(tokenId: string): boolean {
    const store = this.loadStore();
    let changed = false;

    const nextTokens = store.tokens.map((record) => {
      if (record.id !== tokenId || record.revokedAtIso) {
        return record;
      }

      changed = true;
      return {
        ...record,
        revokedAtIso: new Date().toISOString(),
      };
    });

    if (!changed) {
      return false;
    }

    this.saveStore({ ...store, tokens: nextTokens });
    this.refreshActiveTokens();
    this.verificationCache.clear();
    return true;
  }

  /**
   * Returns in-memory active token snapshot and refreshes it on short interval.
   */
  private getActiveTokensSnapshot(): PersistedTokenRecord[] {
    const now = Date.now();
    if (now - this.lastActiveTokenRefreshEpochMs >= ACTIVE_TOKEN_REFRESH_MS) {
      this.refreshActiveTokens();
    }

    return this.cachedActiveTokens;
  }

  /**
   * Reloads active-token snapshot from disk so revocations/rotations propagate
   * without requiring process restart.
   */
  private refreshActiveTokens(): void {
    const store = this.loadStore();
    this.cachedActiveTokens = this.getActiveTokens(store);
    this.lastActiveTokenRefreshEpochMs = Date.now();
  }

  private appendTokenRecord(
    store: PersistedTokenStore,
    token: string,
    label: string,
    ttlDays?: number,
  ): string {
    const salt = randomBytes(16);
    const hash = scryptSync(token, salt, HASH_LENGTH_BYTES);
    const nowIso = new Date().toISOString();
    const expiresAtIso =
      typeof ttlDays === 'number' && ttlDays > 0
        ? new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString()
        : undefined;
    const id = randomUUID();

    store.tokens.push({
      id,
      label,
      saltHex: salt.toString('hex'),
      hashHex: hash.toString('hex'),
      createdAtIso: nowIso,
      expiresAtIso,
    });

    return id;
  }

  /**
   * Filters persisted tokens to currently active set, excluding revoked and
   * expired entries so verification only considers valid credentials.
   */
  private getActiveTokens(store: PersistedTokenStore): PersistedTokenRecord[] {
    const now = Date.now();

    return store.tokens.filter((record) => {
      if (record.revokedAtIso) {
        return false;
      }

      if (!record.expiresAtIso) {
        return true;
      }

      const expiresAt = Date.parse(record.expiresAtIso);
      return Number.isFinite(expiresAt) && expiresAt > now;
    });
  }

  /**
   * Performs constant-time comparison against persisted hash material to reduce
   * timing side-channel leakage during token verification.
   */
  private matchTokenRecord(token: string, saltHex: string, hashHex: string): boolean {
    const salt = Buffer.from(saltHex, 'hex');
    const expectedHash = Buffer.from(hashHex, 'hex');
    const candidateHash = scryptSync(token, salt, HASH_LENGTH_BYTES);

    return (
      expectedHash.length === candidateHash.length && timingSafeEqual(expectedHash, candidateHash)
    );
  }

  /**
   * Loads token store from disk and enforces minimal schema validity before
   * auth decisions rely on persisted credentials.
   */
  private loadStore(): PersistedTokenStore {
    if (!existsSync(this.storePath)) {
      return { version: 1, tokens: [] };
    }

    const raw = readFileSync(this.storePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<PersistedTokenStore>;

    if (parsed.version !== 1 || !Array.isArray(parsed.tokens)) {
      throw new Error(`Invalid auth token store format in ${this.storePath}.`);
    }

    return {
      version: 1,
      tokens: parsed.tokens,
    };
  }

  /**
   * Persists token store with owner-only file permissions to reduce accidental
   * secret-material exposure through host filesystem sharing.
   */
  private saveStore(store: PersistedTokenStore): void {
    mkdirSync(dirname(this.storePath), { recursive: true });
    writeFileSync(this.storePath, `${JSON.stringify(store, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
  }
}
