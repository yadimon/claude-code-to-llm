import assert from "node:assert/strict";
import { runPrompt } from "../src/index.js";

const result = await runPrompt(
  "You MUST call the WebSearch tool at least once. Search for: top Hacker News story right now. Then quote its title verbatim and cite the URL.",
  {
    model: "claude-sonnet-4-6",
    reasoningEffort: "low",
    maxTokens: 1024,
    webSearch: true
  }
);

const events = (result.raw?.events ?? []) as Array<Record<string, unknown>>;
const webSearchRequests = result.usage.webSearchRequests;

function containsWebSearchMarker(value: unknown): boolean {
  if (typeof value === "string") {
    return /web[_-]?search|WebSearch/.test(value);
  }

  if (Array.isArray(value)) {
    return value.some(containsWebSearchMarker);
  }

  if (value && typeof value === "object") {
    return Object.entries(value).some(
      ([key, nestedValue]) => containsWebSearchMarker(key) || containsWebSearchMarker(nestedValue)
    );
  }

  return false;
}

const sawWebSearchToolUse = events.some(event => {
  const message = (event as { message?: { content?: Array<{ type?: string; name?: string }> } })
    .message;
  if (!message?.content) {
    return false;
  }
  return message.content.some(
    block =>
      (block?.type === "server_tool_use" ||
        block?.type === "web_search_tool_result" ||
        block?.type === "tool_use") &&
      containsWebSearchMarker(block)
  );
});

assert.ok(result.content.trim(), "Claude returned an empty response");
assert.ok(
  sawWebSearchToolUse || webSearchRequests > 0,
  "Expected Claude raw events to include WebSearch tool evidence"
);
assert.match(result.content, /https?:\/\//, "Expected the web-search smoke response to cite a URL");

console.log(
  JSON.stringify(
    {
      content: result.content,
      usage: result.usage,
      sawWebSearchToolUse
    },
    null,
    2
  )
);
