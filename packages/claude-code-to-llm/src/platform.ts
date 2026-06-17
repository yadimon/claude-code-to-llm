import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { resolveSpawnForPlatform } from "./spawn.js";

export const MIN_CLAUDE_VERSION = "2.1.179";

const versionCache = new Map<string, string>();

export function isExplicitCliPath(cliPath: string): boolean {
  return cliPath.includes("/") || cliPath.includes("\\") || path.isAbsolute(cliPath);
}

export function explicitCliCandidates(cliPath: string, platform = process.platform): string[] {
  if (platform !== "win32" || path.extname(cliPath)) {
    return [cliPath];
  }

  return [cliPath, `${cliPath}.cmd`, `${cliPath}.bat`, `${cliPath}.exe`];
}

export function assertCliPathExists(cliPath: string, platform = process.platform): void {
  if (!isExplicitCliPath(cliPath)) {
    return;
  }

  const hasMatch = explicitCliCandidates(cliPath, platform).some(candidate => fs.existsSync(candidate));
  if (!hasMatch) {
    throw new Error(
      `Claude Code CLI not found at ${cliPath}. Install Claude Code or pass --cli / CLAUDE_CODE_TO_LLM_CLI_PATH.`
    );
  }
}

export function getClaudeVersion(cliPath: string, platform = process.platform): string {
  const cached = versionCache.get(cliPath);
  if (cached) {
    return cached;
  }
  const resolved = isExplicitCliPath(cliPath)
    ? (explicitCliCandidates(cliPath, platform).find(c => fs.existsSync(c)) ?? cliPath)
    : cliPath;
  const { command, args } = resolveSpawnForPlatform(resolved, ["--version"], platform);
  const output = execFileSync(command, args, {
    encoding: "utf8",
    timeout: 10_000,
    stdio: ["ignore", "pipe", "pipe"]
  });
  const match = output.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    throw new Error(`Could not parse claude CLI version from output: ${output.trim()}`);
  }
  const version = `${match[1]}.${match[2]}.${match[3]}`;
  versionCache.set(cliPath, version);
  return version;
}

export function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map(n => Number.parseInt(n, 10));
  const pb = b.split(".").map(n => Number.parseInt(n, 10));
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

export function assertClaudeVersion(cliPath: string, min: string = MIN_CLAUDE_VERSION): void {
  let version: string;
  try {
    version = getClaudeVersion(cliPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not detect claude CLI version at ${cliPath}: ${message}. ` +
        `Install or upgrade Claude Code (>= ${min}): npm i -g @anthropic-ai/claude-code`,
      { cause: error }
    );
  }
  if (compareSemver(version, min) < 0) {
    throw new Error(
      `claude CLI v${version} at ${cliPath} is too old (requires >= ${min}). ` +
        `Upgrade: npm i -g @anthropic-ai/claude-code`
    );
  }
}

export function normalizeSpawnError(error: unknown, cliPath: string): Error {
  if (typeof error === "object" && error && "code" in error) {
    switch (error.code) {
      case "ENOENT":
        return new Error(
          `Claude Code CLI not found at ${cliPath}. Install Claude Code or pass --cli / CLAUDE_CODE_TO_LLM_CLI_PATH.`
        );
      case "EACCES":
      case "EPERM":
        return new Error(`Claude Code CLI at ${cliPath} is not executable. Check file permissions.`);
      case "EISDIR":
      case "ENOTDIR":
        return new Error(`Claude Code CLI path ${cliPath} is invalid. Check that it points to an executable.`);
      default:
        break;
    }
  }

  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error));
}
