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
});
