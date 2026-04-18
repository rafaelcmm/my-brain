import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileAuthTokenAdapter } from './file-auth-token-adapter.js';

/**
 * Creates isolated on-disk store path for deterministic token persistence tests.
 */
function createStorePath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'my-brain-auth-'));
  return join(dir, 'mcp-auth-tokens.json');
}

/**
 * FileAuthTokenAdapter tests validate auth guarantees and restart persistence.
 */
describe('FileAuthTokenAdapter', () => {
  it('creates bootstrap token and verifies persisted token after restart', () => {
    const storePath = createStorePath();
    const initial = new FileAuthTokenAdapter(storePath);
    initial.ensureActiveToken('0123456789abcdef0123456789abcdef');

    expect(initial.verifyToken('0123456789abcdef0123456789abcdef')).toBe(true);
    expect(initial.verifyToken('wrong-token-value-not-valid')).toBe(false);

    const restarted = new FileAuthTokenAdapter(storePath);
    expect(restarted.verifyToken('0123456789abcdef0123456789abcdef')).toBe(true);
  });

  it('issues and revokes tokens deterministically', () => {
    const storePath = createStorePath();
    const adapter = new FileAuthTokenAdapter(storePath);
    const issued = adapter.issueToken('test-rotate', 1);

    expect(issued.tokenId).toHaveLength(36);
    expect(issued.token.length).toBeGreaterThanOrEqual(64);
    expect(adapter.verifyToken(issued.token)).toBe(true);

    expect(adapter.revokeToken(issued.tokenId)).toBe(true);
    expect(adapter.verifyToken(issued.token)).toBe(false);
  });

  it('rejects short tokens even when store contains active entries', () => {
    const storePath = createStorePath();
    const adapter = new FileAuthTokenAdapter(storePath);
    adapter.ensureActiveToken('0123456789abcdef0123456789abcdef');

    expect(adapter.verifyToken('short')).toBe(false);
  });
});
