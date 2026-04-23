import { env } from "@/lib/config/env";
import { InMemorySessionStore } from "@/lib/infrastructure/session/in-memory-session-store";

/**
 * Returns singleton in-process session store.
 *
 * Why singleton: login and protected requests must share same in-memory map;
 * creating a new store per request would make every session unreadable.
 */
let singletonStore: InMemorySessionStore | null = null;

export function getSessionStore(): InMemorySessionStore {
  if (!singletonStore) {
    singletonStore = new InMemorySessionStore(env().MYBRAIN_WEB_SESSION_SECRET);
  }

  return singletonStore;
}
