/**
 * Application-level project context derivation combining git, filesystem probes,
 * and client-supplied hints.
 *
 * Unlike the pure parse helpers in `domain/project-context.ts`, these functions
 * depend on I/O (fs.existsSync, runGitCommand) so they live in the application
 * layer rather than the pure domain layer.
 */

import fs from "node:fs";
import path from "node:path";
import { runGitCommand } from "../infrastructure/git.js";
import { sanitizeText } from "../domain/memory-validation.js";
import { parseRemoteRepo } from "../domain/project-context.js";

/**
 * Return type of buildProjectContext.
 */
export interface ProjectContext {
  repo: string | null;
  repo_name: string | null;
  project: string | null;
  language: string;
  frameworks: string[];
  author: string | null;
  source: string;
  generated_at: string;
}

/**
 * Optional client-supplied hints that guide context detection.
 */
export interface ProjectContextHints {
  cwd?: unknown;
  git_remote?: unknown;
  author?: unknown;
  repo_hint?: unknown;
  repo_name?: unknown;
  language_hint?: unknown;
  framework_hints?: unknown;
  project_hint?: unknown;
}

/**
 * Detects the probable primary programming language by inspecting manifest files.
 *
 * Priority order: Python (pyproject.toml) > Rust (Cargo.toml) > Go (go.mod) > JavaScript.
 * Returns "javascript" as the safe default when no manifest is found.
 *
 * @param cwd - Workspace directory to inspect.
 * @returns Lowercase language label.
 */
export function detectLanguage(cwd: string): string {
  if (fs.existsSync(path.join(cwd, "pyproject.toml"))) {
    return "python";
  }
  if (fs.existsSync(path.join(cwd, "Cargo.toml"))) {
    return "rust";
  }
  if (fs.existsSync(path.join(cwd, "go.mod"))) {
    return "go";
  }
  return "javascript";
}

/**
 * Detects active frameworks by scanning manifest files in the workspace.
 *
 * Reads package.json dependencies when present and checks for tool-specific
 * files such as docker-compose.yml and Caddyfile.
 *
 * @param cwd - Workspace directory to inspect; defaults to process.cwd().
 * @returns Array of lowercase framework identifier strings.
 */
export function detectFrameworks(cwd: string = process.cwd()): string[] {
  const frameworks = new Set<string>();

  const packageJsonPath = path.join(cwd, "package.json");
  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(
        fs.readFileSync(packageJsonPath, "utf8"),
      ) as Record<string, Record<string, string>>;
      const deps: Record<string, string> = {
        ...(pkg["dependencies"] ?? {}),
        ...(pkg["devDependencies"] ?? {}),
      };

      if (deps["react"]) frameworks.add("react");
      if (deps["next"]) frameworks.add("nextjs");
      if (deps["express"]) frameworks.add("express");
      if (deps["hono"]) frameworks.add("hono");
      if (deps["typescript"]) frameworks.add("typescript");
      if (deps["@modelcontextprotocol/sdk"]) frameworks.add("mcp");
    } catch {
      // Keep probe resilient if package.json is malformed.
    }
  }

  if (fs.existsSync(path.join(cwd, "docker-compose.yml"))) {
    frameworks.add("docker");
  }

  if (fs.existsSync(path.join(cwd, "src", "gateway", "Caddyfile"))) {
    frameworks.add("caddy");
  }

  return Array.from(frameworks);
}

/**
 * Derives a project context object from filesystem probes, git commands, and caller hints.
 *
 * Client hints take precedence: when the caller provides `repo_hint`, `language_hint`,
 * or any other hint field, the source is set to "client-hint". Otherwise the probe
 * falls through git, then package manifests, then a generic fallback.
 *
 * @param hints - Optional shape with caller-controlled overrides.
 * @returns Full project context envelope including provenance tracking fields.
 */
export function buildProjectContext(
  hints: ProjectContextHints = {},
): ProjectContext {
  const hintedCwd = sanitizeText(hints.cwd, 512);
  const cwd = hintedCwd && fs.existsSync(hintedCwd) ? hintedCwd : process.cwd();

  const hintedRemote = sanitizeText(hints.git_remote, 512);
  const remoteOrigin =
    hintedRemote ??
    runGitCommand(["config", "--get", "remote.origin.url"], cwd);

  const author =
    sanitizeText(hints.author, 256) ??
    runGitCommand(["config", "--get", "user.name"], cwd) ??
    runGitCommand(["config", "--get", "user.email"], cwd);

  const { repo, repo_name: repoName } = parseRemoteRepo(remoteOrigin);
  const hintedRepo = sanitizeText(hints.repo_hint, 256);
  const hintedRepoName = sanitizeText(hints.repo_name, 128);
  const hintedLanguage = sanitizeText(hints.language_hint, 64);

  const hintFrameworks: string[] = Array.isArray(hints.framework_hints)
    ? (hints.framework_hints as unknown[])
        .filter((v): v is string => typeof v === "string")
        .map((v) => v.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 8)
    : [];

  const detectedFrameworks = detectFrameworks(cwd);
  const frameworks =
    hintFrameworks.length > 0 ? hintFrameworks : detectedFrameworks;
  const language = hintedLanguage ?? detectLanguage(cwd);

  // Source label encodes where the context came from for debugging and provenance.
  let source = "server-fallback";
  if (hintedRemote ?? hintedRepo ?? hintedRepoName ?? hintedLanguage) {
    source = "client-hint";
  } else if (repo ?? repoName) {
    source = "git";
  } else if (fs.existsSync(path.join(cwd, "package.json"))) {
    source = "package-json";
  } else if (fs.existsSync(path.join(cwd, "Cargo.toml"))) {
    source = "cargo-toml";
  } else if (fs.existsSync(path.join(cwd, "pyproject.toml"))) {
    source = "pyproject";
  }

  return {
    repo: hintedRepo ?? repo,
    repo_name: hintedRepoName ?? repoName,
    project:
      sanitizeText(hints.project_hint, 128) ??
      hintedRepoName ??
      repoName ??
      null,
    language,
    frameworks,
    author,
    source,
    generated_at: new Date().toISOString(),
  };
}
