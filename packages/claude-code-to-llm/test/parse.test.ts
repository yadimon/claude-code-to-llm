import test from "node:test";
import assert from "node:assert/strict";
import { parseClaudeEvents } from "../src/index.js";

test("parseClaudeEvents extracts assistant text and result usage", () => {
  const stdout = [
    JSON.stringify({ type: "system", subtype: "init" }),
    JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "Hi." }]
      }
    }),
    JSON.stringify({
      type: "result",
      subtype: "success",
      result: "Hi.",
      usage: {
        input_tokens: 10,
        cache_creation_input_tokens: 5,
        cache_read_input_tokens: 7,
        output_tokens: 2
      },
      modelUsage: {
        "claude-sonnet-4-6": {
          webSearchRequests: 1
        }
      }
    })
  ].join("\n");

  const parsed = parseClaudeEvents(stdout);
  assert.equal(parsed.content, "Hi.");
  assert.deepEqual(parsed.usage, {
    inputTokens: 10,
    cacheCreationInputTokens: 5,
    cacheReadInputTokens: 7,
    outputTokens: 2,
    totalTokens: 24,
    webSearchRequests: 1,
    webFetchRequests: 0
  });
  assert.equal(parsed.events.length, 3);
});

test("parseClaudeEvents prefers model usage web-search counters over stale server counters", () => {
  const stdout = [
    JSON.stringify({
      type: "result",
      subtype: "success",
      usage: {
        input_tokens: 1,
        output_tokens: 2,
        server_tool_use: {
          web_search_requests: 0,
          web_fetch_requests: 0
        }
      },
      modelUsage: {
        "claude-sonnet-4-6": {
          webSearchRequests: 1,
          webFetchRequests: 2
        }
      }
    })
  ].join("\n");

  const parsed = parseClaudeEvents(stdout);
  assert.equal(parsed.usage.webSearchRequests, 1);
  assert.equal(parsed.usage.webFetchRequests, 2);
});

test("parseClaudeEvents ignores empty assistant blocks and concatenates multiple messages", () => {
  const stdout = [
    JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "" }]
      }
    }),
    JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "First" }]
      }
    }),
    JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", text: "ignored" }, { type: "text", text: "Second" }]
      }
    })
  ].join("\n");

  const parsed = parseClaudeEvents(stdout);
  assert.equal(parsed.content, "First\n\nSecond");
  assert.equal(parsed.events.length, 3);
});
