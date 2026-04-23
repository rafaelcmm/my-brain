import { describe, expect, it } from "vitest";
import { InMemorySessionStore } from "./in-memory-session-store";

/**
 * Session store tests verify encryption-backed session lifecycle contract.
 */
describe("InMemorySessionStore", () => {
  it("creates and resolves bearer from session id", async () => {
    const store = new InMemorySessionStore("0123456789abcdef0123456789abcdef");

    const sessionId = await store.createSession("bearer-token");
    const resolved = await store.getBearer(sessionId);

    expect(resolved).toBe("bearer-token");
  });

  it("invalidates session on destroy", async () => {
    const store = new InMemorySessionStore("0123456789abcdef0123456789abcdef");

    const sessionId = await store.createSession("bearer-token");
    await store.destroySession(sessionId);

    expect(await store.getBearer(sessionId)).toBeNull();
  });

  it("supports non-ascii encryption secret", async () => {
    const store = new InMemorySessionStore("s3gredo-super-seguro-çãõ🔥-12345");

    const sessionId = await store.createSession("bearer-token");
    expect(await store.getBearer(sessionId)).toBe("bearer-token");
  });

  it("cannot decrypt data with different secret", async () => {
    const sourceStore = new InMemorySessionStore(
      "0123456789abcdef0123456789abcdef",
    );
    const sessionId = await sourceStore.createSession("bearer-token");

    const sessions = (
      sourceStore as unknown as {
        sessions: Map<
          string,
          { bearer: string; csrf: string; expiresAt: number }
        >;
      }
    ).sessions;
    const sourceSession = sessions.get(sessionId);
    if (!sourceSession) {
      throw new Error("Expected session to exist");
    }

    const targetStore = new InMemorySessionStore(
      "fedcba9876543210fedcba9876543210",
    );
    const targetSessions = (
      targetStore as unknown as {
        sessions: Map<
          string,
          { bearer: string; csrf: string; expiresAt: number }
        >;
      }
    ).sessions;
    targetSessions.set("reused", { ...sourceSession });

    expect(await targetStore.getBearer("reused")).toBeNull();
  });
});
