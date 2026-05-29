import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { createEmptyUsage } from "./parse.js";
import { DEFAULT_MODEL } from "./types.js";
import type { CoreResponse, RunOptions, Runner, StreamEvent, UsageSummary } from "./types.js";

const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_BETA = [
  "claude-code-20250219",
  "oauth-2025-04-20",
  "interleaved-thinking-2025-05-14",
  "fine-grained-tool-streaming-2025-05-14",
  "context-management-2025-06-27",
  "prompt-caching-scope-2026-01-05",
  "advanced-tool-use-2025-11-20",
  "effort-2025-11-24",
  "structured-outputs-2025-12-15",
  "fast-mode-2026-02-01",
  "redact-thinking-2026-02-12",
  "token-efficient-tools-2026-03-28",
  "advisor-tool-2026-03-01",
  "extended-cache-ttl-2025-04-11",
  "cache-diagnosis-2026-04-07"
].join(",");
const DEFAULT_BASE_URL = "https://api.anthropic.com";
const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const CLAUDE_CODE_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.";

export interface DirectApiRunOptions extends RunOptions {
  directApiBaseUrl?: string;
}

type AnthropicUsage = {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
};

type AnthropicMessage = {
  id?: string;
  model?: string;
  content?: Array<{ type?: string; text?: string }>;
  usage?: AnthropicUsage;
  error?: {
    message?: string;
  };
};

type ClaudeSystemBlock = {
  type: "text";
  text: string;
  cache_control?: {
    type: "ephemeral";
    ttl: "1h";
  };
};

type AnthropicStreamEvent = {
  type?: string;
  message?: AnthropicMessage;
  delta?: {
    type?: string;
    text?: string;
  };
  usage?: AnthropicUsage;
  error?: {
    message?: string;
  };
};

type SseEvent = {
  data: string;
};

export function createDirectApiRunner(baseOptions: DirectApiRunOptions = {}): Runner {
  return {
    runPrompt(prompt, options = {}) {
      return runDirectApiPrompt(prompt, { ...baseOptions, ...options });
    },
    streamPrompt(prompt, options = {}) {
      return streamDirectApiPrompt(prompt, { ...baseOptions, ...options });
    }
  };
}

export async function runDirectApiPrompt(
  prompt: string,
  options: DirectApiRunOptions = {}
): Promise<CoreResponse> {
  const responseId = options.responseId || `resp_${randomUUID().replace(/-/g, "")}`;
  const createdAt = Math.floor(Date.now() / 1000);
  const model = resolveModel(options);
  const rawEvents: unknown[] = [];
  const upstream = await fetchAnthropicMessages(prompt, options, false);
  const event = (await upstream.json()) as AnthropicMessage;
  rawEvents.push(event);

  if (!upstream.ok) {
    throw new Error(formatUpstreamJsonError(upstream.status, event));
  }

  return {
    id: event.id || responseId,
    model: event.model || model,
    prompt,
    createdAt,
    content: extractAnthropicText(event),
    usage: normalizeAnthropicUsage(event.usage),
    raw: {
      stderr: "",
      events: rawEvents
    }
  };
}

export async function* streamDirectApiPrompt(
  prompt: string,
  options: DirectApiRunOptions = {}
): AsyncIterable<StreamEvent> {
  assertPrompt(prompt);
  const fallbackResponseId = options.responseId || `resp_${randomUUID().replace(/-/g, "")}`;
  const createdAt = Math.floor(Date.now() / 1000);
  const fallbackModel = resolveModel(options);
  const rawEvents: unknown[] = [];
  let responseId = fallbackResponseId;
  let model = fallbackModel;
  let content = "";
  let usage = createEmptyUsage();
  let started = false;
  let completed = false;

  const upstream = await fetchAnthropicMessages(prompt, options, true);
  if (!upstream.ok) {
    throw new Error(await readUpstreamError(upstream));
  }
  if (!upstream.body) {
    throw new Error("Anthropic stream response did not include a body");
  }

  for await (const sseEvent of parseSseStream(upstream.body)) {
    if (sseEvent.data === "[DONE]") {
      continue;
    }

    const event = JSON.parse(sseEvent.data) as AnthropicStreamEvent;
    rawEvents.push(event);
    yield { type: "response.raw_event", event };

    if (event.type === "error") {
      throw new Error(event.error?.message || "Anthropic stream failed");
    }

    if (event.type === "message_start") {
      responseId = event.message?.id || responseId;
      model = event.message?.model || model;
      usage = mergeAnthropicUsage(usage, event.message?.usage);
      started = true;
      yield {
        type: "response.started",
        response: { id: responseId, model, prompt, createdAt }
      };
      continue;
    }

    if (!started && event.type === "content_block_delta") {
      started = true;
      yield {
        type: "response.started",
        response: { id: responseId, model, prompt, createdAt }
      };
    }

    if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
      const delta = event.delta.text || "";
      content += delta;
      if (delta) {
        yield { type: "response.output_text.delta", delta };
      }
      continue;
    }

    if (event.type === "message_delta") {
      usage = mergeAnthropicUsage(usage, event.usage);
      continue;
    }

    if (event.type === "message_stop") {
      completed = true;
      yield {
        type: "response.completed",
        response: {
          id: responseId,
          model,
          prompt,
          createdAt,
          content,
          usage,
          raw: { stderr: "", events: rawEvents }
        }
      };
    }
  }

  if (!completed) {
    yield {
      type: "response.completed",
      response: {
        id: responseId,
        model,
        prompt,
        createdAt,
        content,
        usage,
        raw: { stderr: "", events: rawEvents }
      }
    };
  }
}

async function fetchAnthropicMessages(
  prompt: string,
  options: DirectApiRunOptions,
  stream: boolean
): Promise<Response> {
  assertPrompt(prompt);
  if (options.webSearch === true) {
    throw new Error("webSearch is not supported by direct API call mode");
  }

  const accessToken = loadClaudeOAuthAccessToken(options.credentialsPath);
  const body = {
    model: resolveModel(options),
    system: buildSystemBlocks(options.systemPrompt),
    messages: [{ role: "user", content: prompt }],
    max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
    stream
  };
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), options.timeout ?? DEFAULT_TIMEOUT_MS);

  try {
    return await fetch(resolveMessagesUrl(options.directApiBaseUrl), {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "Accept": stream ? "text/event-stream" : "application/json",
        "anthropic-version": ANTHROPIC_VERSION,
        "anthropic-beta": ANTHROPIC_BETA,
        "anthropic-dangerous-direct-browser-access": "true",
        "User-Agent": "claude-cli/2.1.146 (external, cli)",
        "x-app": "cli",
        "x-stainless-arch": normalizeStainlessArch(process.arch),
        "x-stainless-lang": "js",
        "x-stainless-os": normalizeStainlessOs(process.platform),
        "x-stainless-package-version": "0.94.0",
        "x-stainless-runtime": "node",
        "x-stainless-runtime-version": "v24.3.0",
        "x-stainless-timeout": String(Math.ceil((options.timeout ?? DEFAULT_TIMEOUT_MS) / 1000))
      },
      body: JSON.stringify(body),
      signal: abortController.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

function buildSystemBlocks(systemPrompt: string | undefined): ClaudeSystemBlock[] {
  if (systemPrompt && systemPrompt.trim()) {
    return [
      {
        type: "text",
        text: CLAUDE_CODE_IDENTITY
      },
      {
        type: "text",
        text: systemPrompt,
        cache_control: {
          type: "ephemeral",
          ttl: "1h"
        }
      }
    ];
  }

  return [
    {
      type: "text",
      text: CLAUDE_CODE_IDENTITY,
      cache_control: {
        type: "ephemeral",
        ttl: "1h"
      }
    }
  ];
}

function normalizeStainlessOs(platform: NodeJS.Platform): string {
  if (platform === "win32") {
    return "Windows";
  }
  if (platform === "darwin") {
    return "MacOS";
  }
  if (platform === "linux") {
    return "Linux";
  }
  return platform;
}

function normalizeStainlessArch(arch: string): string {
  if (arch === "x64") {
    return "x64";
  }
  if (arch === "arm64") {
    return "arm64";
  }
  return arch;
}

function loadClaudeOAuthAccessToken(credentialsPath?: string): string {
  const envToken = process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim();
  if (envToken) {
    return envToken;
  }

  const resolvedPath =
    credentialsPath ||
    process.env.CLAUDE_CODE_TO_LLM_CREDENTIALS_PATH ||
    path.join(os.homedir(), ".claude", ".credentials.json");
  const parsed = JSON.parse(fs.readFileSync(resolvedPath, "utf8")) as Record<string, unknown>;
  const token = findAccessToken(parsed);

  if (!token) {
    throw new Error(`Claude OAuth access token not found in ${resolvedPath}`);
  }

  return token;
}

function findAccessToken(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  for (const key of ["accessToken", "access_token"]) {
    if (typeof record[key] === "string" && record[key].trim()) {
      return record[key];
    }
  }

  for (const key of ["claudeAiOauth", "oauth", "auth"]) {
    const nested = findAccessToken(record[key]);
    if (nested) {
      return nested;
    }
  }

  return undefined;
}

function resolveMessagesUrl(baseUrl?: string): string {
  const normalized = (
    baseUrl ||
    process.env.CLAUDE_CODE_TO_LLM_DIRECT_API_BASE_URL ||
    process.env.CLAUDE_CODE_TO_LLM_CLAUDE_OAUTH_BASE_URL ||
    DEFAULT_BASE_URL
  ).replace(/\/+$/, "");
  if (normalized.endsWith("/v1/messages")) {
    return normalized;
  }
  if (normalized.endsWith("/v1")) {
    return `${normalized}/messages`;
  }
  return `${normalized}/v1/messages`;
}

function resolveModel(options: RunOptions): string {
  return options.model || process.env.CLAUDE_CODE_TO_LLM_SERVER_DEFAULT_MODEL || DEFAULT_MODEL;
}

function extractAnthropicText(message: AnthropicMessage): string {
  return (message.content || [])
    .filter(block => block.type === "text" && typeof block.text === "string")
    .map(block => block.text)
    .join("");
}

function normalizeAnthropicUsage(usage: AnthropicUsage | undefined): UsageSummary {
  return mergeAnthropicUsage(createEmptyUsage(), usage);
}

function mergeAnthropicUsage(current: UsageSummary, usage: AnthropicUsage | undefined): UsageSummary {
  if (!usage) {
    return current;
  }

  const inputTokens = usage.input_tokens ?? current.inputTokens;
  const cacheCreationInputTokens =
    usage.cache_creation_input_tokens ?? current.cacheCreationInputTokens;
  const cacheReadInputTokens = usage.cache_read_input_tokens ?? current.cacheReadInputTokens;
  const outputTokens = usage.output_tokens ?? current.outputTokens;

  return {
    ...current,
    inputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    outputTokens,
    totalTokens: inputTokens + cacheCreationInputTokens + cacheReadInputTokens + outputTokens
  };
}

async function readUpstreamError(response: Response): Promise<string> {
  const text = await response.text();
  if (!text.trim()) {
    return `Anthropic request failed with HTTP ${response.status}`;
  }

  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } };
    return `Anthropic request failed with HTTP ${response.status}: ${parsed.error?.message || text}`;
  } catch {
    return `Anthropic request failed with HTTP ${response.status}: ${text}`;
  }
}

function formatUpstreamJsonError(status: number, event: AnthropicMessage): string {
  const message = event.error?.message || JSON.stringify(event);
  return `Anthropic request failed with HTTP ${status}: ${message}`;
}

async function* parseSseStream(stream: ReadableStream<Uint8Array>): AsyncIterable<SseEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      yield* drainSseBuffer(buffer, nextBuffer => {
        buffer = nextBuffer;
      });
    }

    buffer += decoder.decode();
    yield* drainSseBuffer(`${buffer}\n\n`, nextBuffer => {
      buffer = nextBuffer;
    });
  } finally {
    reader.releaseLock();
  }
}

function* drainSseBuffer(
  buffer: string,
  updateBuffer: (nextBuffer: string) => void
): Iterable<SseEvent> {
  let cursor = buffer.search(/\r?\n\r?\n/);
  while (cursor !== -1) {
    const rawEvent = buffer.slice(0, cursor);
    const match = buffer.slice(cursor).match(/^\r?\n\r?\n/);
    buffer = buffer.slice(cursor + (match?.[0].length || 2));
    const parsed = parseSseEvent(rawEvent);
    if (parsed) {
      yield parsed;
    }
    cursor = buffer.search(/\r?\n\r?\n/);
  }
  updateBuffer(buffer);
}

function parseSseEvent(rawEvent: string): SseEvent | undefined {
  const dataLines: string[] = [];

  for (const line of rawEvent.split(/\r?\n/)) {
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }

  if (dataLines.length === 0) {
    return undefined;
  }

  return {
    data: dataLines.join("\n")
  };
}

function assertPrompt(prompt: string): void {
  if (typeof prompt !== "string") {
    throw new Error("Prompt must be a string");
  }
  if (!prompt.trim()) {
    throw new Error("Prompt must not be empty");
  }
}
