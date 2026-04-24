import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { FileSessionStore } from "./file-session-store";

/**
 * File-backed store tests ensure sessions survive adapter boundaries.
 */
describe("FileSessionStore", () => {
  it("shares sessions across store instances pointing to same file", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "my-brain-web-session-test-"));
    const storagePath = join(baseDir, "sessions.json");

    try {
      const storeA = new FileSessionStore(
        "0123456789abcdef0123456789abcdef",
        storagePath,
      );
      const sessionId = await storeA.createSession("bearer-token");

      const storeB = new FileSessionStore(
        "0123456789abcdef0123456789abcdef",
        storagePath,
      );
      expect(await storeB.getBearer(sessionId)).toBe("bearer-token");
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  it("preserves csrf token across store instances", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "my-brain-web-session-test-"));
    const storagePath = join(baseDir, "sessions.json");

    try {
      const storeA = new FileSessionStore(
        "0123456789abcdef0123456789abcdef",
        storagePath,
      );
      const sessionId = await storeA.createSession("bearer-token");
      const csrf = await storeA.getCSRFToken(sessionId);

      const storeB = new FileSessionStore(
        "0123456789abcdef0123456789abcdef",
        storagePath,
      );
      expect(await storeB.verifyCSRFToken(sessionId, csrf)).toBe(true);
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });
});
