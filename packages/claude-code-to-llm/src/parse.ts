import type { ParsedClaudeEvents, UsageSummary } from "./types.js";

type TextBlock = {
  type?: string;
  text?: string;
};

type AssistantMessageEvent = {
  type: "assistant";
  message?: {
    content?: TextBlock[];
  };
};

type ResultEvent = {
  type: "result";
  subtype?: string;
  result?: string;
  usage?: {
    input_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    output_tokens?: number;
  };
};

export function parseClaudeEvents(stdout: string): ParsedClaudeEvents {
  const events: unknown[] = [];
  let content = "";
  let usage = createEmptyUsage();

  for (const rawLine of stdout.split(/\r?\n/)) {
    const event = parseClaudeEventLine(rawLine);
    if (!event) {
      continue;
    }

    events.push(event);

    if (isAssistantMessageEvent(event)) {
      const messageText = getAssistantMessageText(event);
      if (messageText) {
        content = content ? `${content}\n\n${messageText}` : messageText;
      }
    }

    if (isResultEvent(event) && event.usage) {
      usage = normalizeUsage(event.usage);
      if (!content && typeof event.result === "string" && event.result.trim()) {
        content = event.result.trim();
      }
    }
  }

  return { content, usage, events };
}

export function parseClaudeEventLine(rawLine: string): Record<string, unknown> | null {
  const line = String(rawLine || "").trim();
  if (!line) {
    return null;
  }

  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

export function isAssistantMessageEvent(
  event: Record<string, unknown>
): event is AssistantMessageEvent & { message: { content: TextBlock[] } } {
  return (
    event?.type === "assistant" &&
    typeof event.message === "object" &&
    event.message !== null &&
    "content" in event.message &&
    Array.isArray(event.message.content)
  );
}

export function isResultEvent(event: Record<string, unknown>): event is ResultEvent {
  return event?.type === "result";
}

export function getAssistantMessageText(
  event: AssistantMessageEvent & { message: { content: TextBlock[] } }
): string {
  return event.message.content
    .filter(block => block?.type === "text" && typeof block.text === "string" && block.text.trim())
    .map(block => block.text!.trim())
    .join("\n\n");
}

export function createEmptyUsage(): UsageSummary {
  return {
    inputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    outputTokens: 0,
    totalTokens: 0
  };
}

export function normalizeUsage(usage: ResultEvent["usage"]): UsageSummary {
  const inputTokens = usage?.input_tokens ?? 0;
  const cacheCreationInputTokens = usage?.cache_creation_input_tokens ?? 0;
  const cacheReadInputTokens = usage?.cache_read_input_tokens ?? 0;
  const outputTokens = usage?.output_tokens ?? 0;

  return {
    inputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    outputTokens,
    totalTokens: inputTokens + cacheCreationInputTokens + cacheReadInputTokens + outputTokens
  };
}
