/**
 * Git shell integration for reading repository metadata at runtime.
 *
 * `runGitCommand` is deliberately restricted to execFileSync with a hardcoded
 * "git" binary so callers cannot inject arbitrary shell commands through the
 * args array. Callers must only pass known-safe git sub-commands and options.
 */

import { execFileSync } from "node:child_process";

/**
 * Runs a git sub-command and returns trimmed stdout on success.
 *
 * Security boundary: args must be hardcoded by the caller — never derived from
 * user-supplied input. The function uses execFileSync (no shell interpolation)
 * and caps buffering to 16 KiB so it cannot be used to read large blobs.
 *
 * @param args - Git sub-command and flags, e.g. `["config", "--get", "remote.origin.url"]`.
 * @param cwd - Working directory for the git call; defaults to process.cwd().
 * @returns Trimmed stdout string, or null when the command fails or produces no output.
 */
export function runGitCommand(
  args: readonly string[],
  cwd: string = process.cwd(),
): string | null {
  try {
    const output = execFileSync("git", args, {
      cwd,
      timeout: 2000,
      maxBuffer: 16 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString("utf8")
      .trim();

    return output || null;
  } catch {
    return null;
  }
}
