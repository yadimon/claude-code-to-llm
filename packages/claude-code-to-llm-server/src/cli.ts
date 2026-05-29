#!/usr/bin/env node

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createCliArgReader } from "@yadimon/claude-code-to-llm";
import { startServer } from "./index.js";

const args = process.argv.slice(2);
const { getArg, hasFlag } = createCliArgReader(args);
export const HELP_TEXT = `claude-code-to-llm-server

Usage:
  claude-code-to-llm-server --host 127.0.0.1 --port 3000

Options:
  --host <host>
  --port <port>
  --model <name>
  --backend <claude-cli|claude-oauth>
  --api-key <value>
  --search
  --direct-api-base-url <url>
  --claude-oauth-base-url <url>
  --auth-path <path>
  --credentials-path <path>
  --settings-path <path>
  --config-home <path>
  --cwd <path>
  --cli <path>`;

export async function main(): Promise<void> {
  if (hasFlag("--help") || hasFlag("-h")) {
    console.log(HELP_TEXT);
    return;
  }

  const portArg = getArg("--port");
  const port = parsePort(portArg);
  const backend = parseBackend(getArg("--backend") || process.env.CLAUDE_CODE_TO_LLM_BACKEND);
  if (backend === "claude-oauth") {
    warnClaudeOAuthRisk();
  }
  const started = await startServer({
    host: getArg("--host"),
    port,
    defaultModel: getArg("--model"),
    backend,
    apiKey: getArg("--api-key"),
    webSearch: hasFlag("--search") || undefined,
    directApiBaseUrl: getArg("--direct-api-base-url"),
    claudeOAuthBaseUrl: getArg("--claude-oauth-base-url"),
    authPath: getArg("--auth-path"),
    credentialsPath: getArg("--credentials-path"),
    settingsPath: getArg("--settings-path"),
    configHome: getArg("--config-home"),
    cwd: getArg("--cwd"),
    cliPath: getArg("--cli")
  });

  console.log(`claude-code-to-llm-server listening on ${started.url}`);
}

function warnClaudeOAuthRisk(): void {
  const warning = [
    "WARNING: claude-code-to-llm is running in Claude subscription direct mode.",
    "This mode uses your Claude/Claude Code OAuth session to call Anthropic-compatible endpoints.",
    "It is not the normal ANTHROPIC_API_KEY billing path.",
    "Anthropic may change, restrict, rate-limit, or block this behavior.",
    "Use only with accounts you control. Do not expose this server to untrusted networks."
  ].join("\n");

  console.error(warning);
  if (
    process.env.CLAUDE_CODE_TO_LLM_ACCEPT_SUBSCRIPTION_DIRECT_RISK !== "1" &&
    process.env.CLAUDE_CODE_TO_LLM_ACCEPT_DIRECT_API_CALL_RISK !== "1"
  ) {
    throw new Error(
      "Set CLAUDE_CODE_TO_LLM_ACCEPT_DIRECT_API_CALL_RISK=1 to start claude-oauth mode."
    );
  }
}

function parseBackend(backendArg: string | undefined): "claude-cli" | "claude-oauth" | undefined {
  if (backendArg == null) {
    return undefined;
  }

  if (backendArg === "claude-cli" || backendArg === "claude-oauth") {
    return backendArg;
  }

  throw new Error("Invalid --backend: expected claude-cli or claude-oauth");
}

function parsePort(portArg: string | undefined): number | undefined {
  if (portArg == null) {
    return undefined;
  }

  const port = Number.parseInt(portArg, 10);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("Invalid --port: expected an integer between 0 and 65535");
  }

  return port;
}

const modulePath = fs.realpathSync.native(fileURLToPath(import.meta.url));
const invokedPath = process.argv[1] ? fs.realpathSync.native(path.resolve(process.argv[1])) : null;
const isDirectExecution = Boolean(invokedPath) && invokedPath === modulePath;

if (isDirectExecution) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
