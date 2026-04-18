import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  createEmptyUsage,
  getAssistantMessageText,
  isAssistantMessageEvent,
  isResultEvent,
  normalizeUsage,
  parseClaudeEventLine
} from "./parse.js";
import { assertCliPathExists, normalizeSpawnError } from "./platform.js";
import { AsyncQueue } from "./queue.js";
import { resolveSpawn } from "./spawn.js";
import { createClaudeCodeHome, createWorkspace, cleanupDirectory } from "./workspace.js";
import { DEFAULT_MODEL, DEFAULT_REASONING_EFFORT } from "./types.js";
import type {
  CoreResponse,
  NormalizedRunOptions,
  ResponseShell,
  RunOptions,
  Runner,
  StreamEvent,
  UsageSummary
} from "./types.js";

export function createRunner(baseOptions: RunOptions = {}): Runner {
  return {
    runPrompt(prompt, options = {}) {
      return runPrompt(prompt, { ...baseOptions, ...options });
    },
    streamPrompt(prompt, options = {}) {
      return streamPrompt(prompt, { ...baseOptions, ...options });
    }
  };
}

export async function runPrompt(prompt: string, options: RunOptions = {}): Promise<CoreResponse> {
  const stream = streamPrompt(prompt, options);
  let completedResponse: CoreResponse | undefined;

  for await (const event of stream) {
    if (event.type === "response.completed") {
      completedResponse = event.response;
    }
  }

  if (!completedResponse) {
    throw new Error("Claude Code completed without a response payload");
  }

  return completedResponse;
}

export function streamPrompt(prompt: string, options: RunOptions = {}): AsyncIterable<StreamEvent> {
  if (typeof prompt !== "string") {
    throw new Error("Prompt must be a string");
  }

  if (!prompt.trim()) {
    throw new Error("Prompt must not be empty");
  }

  const normalizedOptions = normalizeRunOptions(options);
  const { model, reasoningEffort, maxTokens, timeoutMs, cliPath } = normalizedOptions;
  assertCliPathExists(cliPath);
  const ownsWorkspace = !options.cwd;
  const ownsClaudeHome = !options.configHome;
  let workspace: string | undefined;
  let claudeHome: string | undefined;

  try {
    workspace = createWorkspace(options.cwd);
    claudeHome = createClaudeCodeHome({
      authPath: options.authPath,
      credentialsPath: options.credentialsPath,
      settingsPath: options.settingsPath,
      configHome: options.configHome
    });
  } catch (error) {
    throw withCleanupPreserved(error, [
      () => cleanupDirectory(workspace, ownsWorkspace),
      () => cleanupDirectory(claudeHome, ownsClaudeHome)
    ]);
  }

  const responseId = options.responseId || `resp_${randomUUID().replace(/-/g, "")}`;
  const startedAt = Date.now();
  const queue = new AsyncQueue<StreamEvent>();
  const rawEvents: unknown[] = [];
  let settled = false;
  let content = "";
  let stderr = "";
  let stdoutBuffer = "";
  let usage: UsageSummary = createEmptyUsage();

  const cliArgs = [
    "--print",
    "--output-format",
    "stream-json",
    "--model",
    model,
    "--effort",
    reasoningEffort,
    "--no-session-persistence",
    prompt
  ];

  queue.push({
    type: "response.started",
    response: createResponseShell({
      responseId,
      model,
      prompt,
      startedAt
    })
  });

  const spawnConfig = resolveSpawn(cliPath, cliArgs);
  const child: ChildProcessWithoutNullStreams = spawn(spawnConfig.command, spawnConfig.args, {
    cwd: workspace,
    env: {
      ...process.env,
      HOME: claudeHome,
      USERPROFILE: claudeHome,
      CLAUDE_CODE_MAX_OUTPUT_TOKENS: maxTokens == null ? undefined : String(maxTokens)
    },
    windowsHide: true
  });
  const timeoutHandle = setTimeout(() => {
    if (!settled) {
      finalizeFailure(new Error(`Claude Code execution timeout after ${timeoutMs}ms`));
    }
  }, timeoutMs);

  function finalizeSuccess(): void {
    if (settled) {
      return;
    }
    settled = true;
    clearTimeout(timeoutHandle);
    flushStdoutBuffer();

    const response: CoreResponse = {
      ...createResponseShell({
        responseId,
        model,
        prompt,
        startedAt
      }),
      content,
      usage,
      raw: {
        stderr: stderr.trim(),
        events: rawEvents
      }
    };

    cleanupDirectory(workspace, ownsWorkspace);
    cleanupDirectory(claudeHome, ownsClaudeHome);
    queue.push({
      type: "response.completed",
      response
    });
    queue.close();
  }

  function finalizeFailure(error: Error): void {
    if (settled) {
      return;
    }
    settled = true;
    clearTimeout(timeoutHandle);
    if (!child.killed) {
      child.kill();
    }
    flushStdoutBuffer();

    cleanupDirectory(workspace, ownsWorkspace);
    cleanupDirectory(claudeHome, ownsClaudeHome);
    queue.push({
      type: "response.failed",
      error: {
        message: error.message
      }
    });
    queue.fail(error);
  }

  function flushStdoutBuffer(): void {
    if (!stdoutBuffer.trim()) {
      stdoutBuffer = "";
      return;
    }

    processStdoutLine(stdoutBuffer);
    stdoutBuffer = "";
  }

  function processStdoutLine(rawLine: string): void {
    const event = parseClaudeEventLine(rawLine);
    if (!event) {
      return;
    }

    rawEvents.push(event);
    queue.push({
      type: "response.raw_event",
      event
    });

    if (isAssistantMessageEvent(event)) {
      const messageText = getAssistantMessageText(event);
      if (messageText) {
        content = content ? `${content}\n\n${messageText}` : messageText;
        queue.push({
          type: "response.output_text.delta",
          delta: messageText
        });
      }
    }

    if (isResultEvent(event)) {
      if (event.usage) {
        usage = normalizeUsage(event.usage);
      }

      if (!content && typeof event.result === "string" && event.result.trim()) {
        content = event.result.trim();
      }

      if (event.subtype && event.subtype !== "success") {
        finalizeFailure(new Error(typeof event.result === "string" ? event.result : "Claude Code request failed"));
      }
    }
  }

  child.stdout.on("data", chunk => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() || "";
    for (const line of lines) {
      processStdoutLine(line);
    }
  });

  child.stderr.on("data", chunk => {
    stderr = appendBounded(stderr, chunk.toString());
  });

  child.on("error", error => {
    finalizeFailure(normalizeSpawnError(error, cliPath));
  });

  child.on("close", (code, signal) => {
    setImmediate(() => {
      const exitError = createClaudeCodeExitError(code, signal, stderr);
      if (exitError) {
        finalizeFailure(exitError);
        return;
      }

      finalizeSuccess();
    });
  });

  try {
    child.stdin.end();
  } catch (error) {
    finalizeFailure(error instanceof Error ? error : new Error(String(error)));
  }

  return queue;
}

export const execClaudeCode = runPrompt;

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_STDERR_LENGTH = 64 * 1024;
const CLI_TOKEN_PATTERN = /^[A-Za-z0-9._:/-]+$/;
const VALID_REASONING_EFFORTS = new Set(["low", "medium", "high", "max"]);

export function normalizeRunOptions(options: RunOptions = {}): NormalizedRunOptions {
  return {
    model: normalizeCliToken(options.model, DEFAULT_MODEL, "model"),
    reasoningEffort: normalizeReasoningEffort(options.reasoningEffort),
    maxTokens: normalizeMaxTokens(options.maxTokens),
    timeoutMs: normalizeTimeout(options.timeout),
    cliPath: normalizeCliPath(options.cliPath)
  };
}

function normalizeCliPath(value: string | undefined): string {
  const normalized =
    value ||
    process.env.CLAUDE_CODE_TO_LLM_CLI_PATH ||
    (process.platform === "win32" ? "claude.exe" : "claude");
  if (!normalized.trim()) {
    throw new Error("Invalid cliPath: expected a non-empty path or command");
  }

  return normalized;
}

function normalizeCliToken(value: string | undefined, fallback: string, fieldName: string): string {
  const normalized = value || fallback;
  if (!CLI_TOKEN_PATTERN.test(normalized) || normalized.startsWith("-")) {
    throw new Error(
      `Invalid ${fieldName}: expected letters, digits, dots, colons, slashes, underscores, or hyphens`
    );
  }

  return normalized;
}

function normalizeReasoningEffort(value: string | undefined): string {
  const normalized = value || DEFAULT_REASONING_EFFORT;
  if (!VALID_REASONING_EFFORTS.has(normalized)) {
    throw new Error('Invalid reasoning effort: expected "low", "medium", "high", or "max"');
  }

  return normalized;
}

function normalizeTimeout(value: number | undefined): number {
  if (value == null) {
    return DEFAULT_TIMEOUT_MS;
  }

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("Invalid timeout: expected a positive integer number of milliseconds");
  }

  return value;
}

function normalizeMaxTokens(value: number | undefined): number | undefined {
  if (value == null) {
    return undefined;
  }

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("Invalid maxTokens: expected a positive integer");
  }

  return value;
}

function appendBounded(current: string, nextChunk: string): string {
  const combined = current + nextChunk;
  if (combined.length <= MAX_STDERR_LENGTH) {
    return combined;
  }

  const tailLength = MAX_STDERR_LENGTH - "\n[stderr truncated]".length;
  return `${combined.slice(-tailLength)}\n[stderr truncated]`;
}

export function createClaudeCodeExitError(
  code: number | null,
  signal: NodeJS.Signals | null,
  stderr: string
): Error | undefined {
  const normalizedStderr = stderr.trim();
  if (signal) {
    return new Error(normalizedStderr || `Claude Code exited due to signal ${signal}`);
  }

  if (code !== 0) {
    return new Error(normalizedStderr || `Claude Code exited with code ${code}`);
  }

  return undefined;
}

function withCleanupPreserved(error: unknown, cleanupTasks: Array<() => void>): Error {
  const originalError = error instanceof Error ? error : new Error(String(error));

  for (const cleanupTask of cleanupTasks) {
    try {
      cleanupTask();
    } catch (cleanupError) {
      originalError.message = `${originalError.message} (cleanup failed: ${
        cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
      })`;
    }
  }

  return originalError;
}

function createResponseShell({
  responseId,
  model,
  prompt,
  startedAt
}: {
  responseId: string;
  model: string;
  prompt: string;
  startedAt: number;
}): ResponseShell {
  return {
    id: responseId,
    model,
    prompt,
    createdAt: Math.floor(startedAt / 1000)
  };
}
