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

const resultEvent = events.find(event => event.type === "result") as
  | { usage?: { server_tool_use?: { web_search_requests?: number } } }
  | undefined;
const webSearchRequests = resultEvent?.usage?.server_tool_use?.web_search_requests ?? 0;

const sawWebSearchToolUse = events.some(event => {
  const message = (event as { message?: { content?: Array<{ type?: string; name?: string }> } })
    .message;
  if (!message?.content) {
    return false;
  }
  return message.content.some(
    block =>
      block?.type === "server_tool_use" ||
      block?.type === "web_search_tool_result" ||
      block?.type === "tool_use"
  );
});

console.log(
  JSON.stringify(
    {
      content: result.content,
      usage: result.usage,
      webSearchRequests,
      sawWebSearchToolUse
    },
    null,
    2
  )
);
