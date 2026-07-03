import * as fs from "node:fs";
import * as path from "node:path";
import type { SpawnResolution } from "./types.js";

export function quoteCmdArg(arg: string): string {
  if (arg.length === 0) {
    return "\"\"";
  }
  if (!/[\s"&|<>^()]/.test(arg)) {
    return arg;
  }
  return `"${arg.replace(/"/g, "\"\"")}"`;
}

// The cmd.exe wrapper cannot forward newlines (cmd truncates the command
// line at the first newline) and requires cmd-specific quoting. Prefer a
// real .exe so the wrapper is only used as a last resort.
export function preferWindowsExecutable(
  cliPath: string,
  platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): string {
  if (platform !== "win32" || path.extname(cliPath)) {
    return cliPath;
  }

  const isExplicitPath = cliPath.includes("/") || cliPath.includes("\\");
  if (isExplicitPath) {
    const exeCandidate = `${cliPath}.exe`;
    return fs.existsSync(exeCandidate) ? exeCandidate : cliPath;
  }

  const pathValue = env.PATH ?? env.Path ?? "";
  for (const dir of pathValue.split(path.delimiter)) {
    if (!dir) {
      continue;
    }
    const exeCandidate = path.join(dir, `${cliPath}.exe`);
    if (fs.existsSync(exeCandidate)) {
      return exeCandidate;
    }
  }

  return cliPath;
}

export function resolveSpawnForPlatform(
  cliPath: string,
  cliArgs: string[],
  platform = process.platform
): SpawnResolution {
  const ext = path.extname(cliPath).toLowerCase();
  const isCmdShim = platform === "win32" && [".cmd", ".bat"].includes(ext);
  const useCmdWrapper = platform === "win32" && (isCmdShim || !ext);
  if (!useCmdWrapper) {
    return { command: cliPath, args: cliArgs };
  }

  if ([cliPath, ...cliArgs].some(part => /[\r\n]/.test(part))) {
    throw new Error(
      `Arguments with newlines cannot be passed through the cmd.exe wrapper required for ${cliPath}. ` +
        "Point cliPath / CLAUDE_CODE_TO_LLM_CLI_PATH at the claude .exe binary instead."
    );
  }

  // cmd.exe /s /c strips the outer quotes and runs the rest verbatim. The
  // spawn caller must set windowsVerbatimArguments so Node does not re-quote
  // the pre-quoted line MSVCRT-style (which splits args at spaces).
  return {
    command: "cmd.exe",
    args: ["/d", "/s", "/c", `"${[cliPath, ...cliArgs].map(quoteCmdArg).join(" ")}"`],
    windowsVerbatimArguments: true
  };
}

export function resolveSpawn(cliPath: string, cliArgs: string[]): SpawnResolution {
  return resolveSpawnForPlatform(preferWindowsExecutable(cliPath), cliArgs, process.platform);
}
