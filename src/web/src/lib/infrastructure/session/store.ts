import { env } from "@/lib/config/env";
import { FileSessionStore } from "@/lib/infrastructure/session/file-session-store";

/**
 * Returns singleton in-process session store.
 *
 * Why singleton: caller code expects a single adapter instance and shared
 * storage path. The underlying file storage keeps session state visible across
 * Next.js runtime boundaries.
 */
let singletonStore: FileSessionStore | null = null;

export function getSessionStore(): FileSessionStore {
  if (!singletonStore) {
    singletonStore = new FileSessionStore(env().MYBRAIN_WEB_SESSION_SECRET);
  }

  return singletonStore;
}
