import type { ParsedRemoteRepo } from "./types.js";

/**
 * Normalizes repository selectors across full URLs, git remotes, and short-name forms so SQL filters can match equivalent inputs consistently.
 *
 * @param value - Raw repository selector from API filters or client hints.
 * @returns Ordered unique selector variants spanning raw, normalized, and basename forms.
 */
export function normalizeRepoSelector(value: string | null): string[] {
  if (!value || typeof value !== "string") {
    return [];
  }

  const raw = value.trim();
  if (!raw) {
    return [];
  }

  const normalized = raw
    .replace(/^https?:\/\//, "")
    .replace(/^git@/, "")
    .replace(/^([^/]+):(.+)$/, "$1/$2")
    .replace(/\.git$/, "")
    .toLowerCase();
  const basename = normalized.split("/").filter(Boolean).pop() ?? normalized;

  return Array.from(new Set([raw, normalized, basename]));
}

/**
 * Derives canonical repository identifiers from a git remote without depending on filesystem or subprocess state.
 *
 * @param remoteUrl - Raw git remote URL or SCP-like git reference.
 * @returns Normalized repository identifiers used by stored metadata.
 */
export function parseRemoteRepo(
  remoteUrl: string | null | undefined,
): ParsedRemoteRepo {
  if (!remoteUrl) {
    return { repo: null, repo_name: null };
  }

  const normalized = remoteUrl
    .replace(/^https?:\/\//, "")
    .replace(/^git@/, "")
    .replace(/^([^/]+):(.+)$/, "$1/$2")
    .replace(/\.git$/, "");

  const parts = normalized.split("/").filter(Boolean);
  const repoName = parts.at(-1) ?? null;

  return {
    repo: normalized,
    repo_name: repoName,
  };
}
