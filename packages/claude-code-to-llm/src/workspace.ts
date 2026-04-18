import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

type AuthBundlePaths = {
  sessionPath: string;
  credentialsPath: string;
  settingsPath?: string;
};

export function resolveDefaultAuthPaths(): AuthBundlePaths {
  const home = os.homedir();
  if (!home) {
    throw new Error("Unable to resolve the user home directory");
  }

  return {
    sessionPath: path.join(home, ".claude.json"),
    credentialsPath: path.join(home, ".claude", ".credentials.json"),
    settingsPath: path.join(home, ".claude", "settings.json")
  };
}

export function resolveAuthPaths(options: {
  authPath?: string;
  credentialsPath?: string;
  settingsPath?: string;
} = {}): AuthBundlePaths {
  const defaults = resolveDefaultAuthPaths();
  const base = resolvePathsFromAuthPath(options.authPath);

  return {
    sessionPath: base.sessionPath || defaults.sessionPath,
    credentialsPath: options.credentialsPath || base.credentialsPath || defaults.credentialsPath,
    settingsPath: options.settingsPath || base.settingsPath || defaults.settingsPath
  };
}

export function prepareAuthCopy(options: {
  authPath?: string;
  credentialsPath?: string;
  settingsPath?: string;
  targetPath?: string;
  targetDir?: string;
} = {}): string {
  const authPaths = resolveAuthPaths(options);
  assertAuthBundleExists(authPaths);

  const explicitTargetPath = options.targetPath;
  const targetDir = explicitTargetPath
    ? path.dirname(explicitTargetPath)
    : options.targetDir ||
      process.env.CLAUDE_CODE_TO_LLM_LOCAL_HOME ||
      path.join(process.cwd(), ".claude-code-to-llm");
  fs.mkdirSync(path.join(targetDir, ".claude"), { recursive: true });

  const targetSessionPath = explicitTargetPath || path.join(targetDir, ".claude.json");
  fs.copyFileSync(authPaths.sessionPath, targetSessionPath);
  fs.copyFileSync(authPaths.credentialsPath, path.join(targetDir, ".claude", ".credentials.json"));

  if (authPaths.settingsPath && fs.existsSync(authPaths.settingsPath)) {
    fs.copyFileSync(authPaths.settingsPath, path.join(targetDir, ".claude", "settings.json"));
  }

  return targetSessionPath;
}

export function createClaudeCodeHome(options: {
  authPath?: string;
  credentialsPath?: string;
  settingsPath?: string;
  configHome?: string;
} = {}): string {
  const authPaths = resolveAuthPaths(options);
  assertAuthBundleExists(authPaths);

  const rootDir =
    options.configHome || fs.mkdtempSync(path.join(os.tmpdir(), "claude-code-to-llm-home-"));
  fs.mkdirSync(path.join(rootDir, ".claude"), { recursive: true });

  fs.copyFileSync(authPaths.sessionPath, path.join(rootDir, ".claude.json"));
  fs.copyFileSync(
    authPaths.credentialsPath,
    path.join(rootDir, ".claude", ".credentials.json")
  );

  if (authPaths.settingsPath && fs.existsSync(authPaths.settingsPath)) {
    fs.copyFileSync(authPaths.settingsPath, path.join(rootDir, ".claude", "settings.json"));
  }

  return rootDir;
}

export function createWorkspace(workspacePath?: string): string {
  const rootDir =
    workspacePath || fs.mkdtempSync(path.join(os.tmpdir(), "claude-code-to-llm-workspace-"));
  fs.mkdirSync(rootDir, { recursive: true });
  return rootDir;
}

export function cleanupDirectory(directoryPath: string | undefined, shouldCleanup: boolean): void {
  if (!shouldCleanup || !directoryPath) {
    return;
  }

  fs.rmSync(directoryPath, { recursive: true, force: true });
}

function resolvePathsFromAuthPath(explicitPath?: string): Partial<AuthBundlePaths> {
  if (!explicitPath) {
    return {};
  }

  const resolved = path.resolve(explicitPath);
  if (!fs.existsSync(resolved)) {
    return {
      sessionPath: resolved
    };
  }

  const stats = fs.statSync(resolved);
  if (stats.isDirectory()) {
    if (path.basename(resolved) === ".claude") {
      const homeRoot = path.dirname(resolved);
      return {
        sessionPath: path.join(homeRoot, ".claude.json"),
        credentialsPath: path.join(resolved, ".credentials.json"),
        settingsPath: path.join(resolved, "settings.json")
      };
    }

    return {
      sessionPath: path.join(resolved, ".claude.json"),
      credentialsPath: path.join(resolved, ".claude", ".credentials.json"),
      settingsPath: path.join(resolved, ".claude", "settings.json")
    };
  }

  if (path.basename(resolved) === ".credentials.json") {
    const claudeDir = path.dirname(resolved);
    return {
      sessionPath: path.join(path.dirname(claudeDir), ".claude.json"),
      credentialsPath: resolved,
      settingsPath: path.join(claudeDir, "settings.json")
    };
  }

  return {
    sessionPath: resolved,
    credentialsPath: path.join(path.dirname(resolved), ".claude", ".credentials.json"),
    settingsPath: path.join(path.dirname(resolved), ".claude", "settings.json")
  };
}

function assertAuthBundleExists(authPaths: AuthBundlePaths): void {
  if (!fs.existsSync(authPaths.sessionPath)) {
    throw new Error(`Claude Code session auth not found at ${authPaths.sessionPath}`);
  }

  if (!fs.existsSync(authPaths.credentialsPath)) {
    throw new Error(`Claude Code credentials not found at ${authPaths.credentialsPath}`);
  }
}
