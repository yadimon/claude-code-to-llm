import { runPrompt } from "../src/index.js";

const result = await runPrompt("Hi", {
  model: "claude-sonnet-4-6",
  reasoningEffort: "low",
  maxTokens: 128
});

console.log(
  JSON.stringify(
    {
      content: result.content,
      usage: result.usage
    },
    null,
    2
  )
);
