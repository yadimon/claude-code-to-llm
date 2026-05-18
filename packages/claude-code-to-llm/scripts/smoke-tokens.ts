// Token-budget smoke test: runs the same trivial "say hi" prompt
// through real claude 3 times back-to-back and reports a per-call
// breakdown. Goals:
//   1) Diagnose the prompt-cache behaviour empirically (which call
//      writes the cache, which calls read it).
//   2) Catch regressions where Anthropic or Claude Code inflates the
//      framework prompt — the *minimum* call-2/call-3 total across the
//      three runs is the most stable indicator and is what we budget.
//
// Why call 1 is unreliable: Anthropic's prompt cache may still be warm
// from prior user activity (interactive `claude` use, other wrapper
// runs), so call 1 can come back as cacheRead-heavy even on a "cold"
// start. Calls 2 and 3 should reliably hit the cache from call 1.
//
// Tune via SMOKE_TOKENS_BUDGET.

import { runPrompt } from "../src/index.js";
import type { UsageSummary } from "../src/index.js";

const BUDGET = Number.parseInt(process.env.SMOKE_TOKENS_BUDGET ?? "8000", 10);
const PROMPT = "say hi";
const RUNS = 3;

type CallResult = {
  call: number;
  content: string;
  usage: UsageSummary;
  totalPromptTokens: number;
};

const results: CallResult[] = [];
for (let i = 1; i <= RUNS; i++) {
  const result = await runPrompt(PROMPT, {
    model: "claude-sonnet-4-6",
    reasoningEffort: "low",
    maxTokens: 32
  });
  const totalPromptTokens =
    result.usage.inputTokens +
    result.usage.cacheCreationInputTokens +
    result.usage.cacheReadInputTokens;
  results.push({ call: i, content: result.content, usage: result.usage, totalPromptTokens });
}

console.log(
  JSON.stringify(
    {
      prompt: PROMPT,
      budget: BUDGET,
      runs: results.map(r => ({
        call: r.call,
        content: r.content,
        input: r.usage.inputTokens,
        cacheCreate: r.usage.cacheCreationInputTokens,
        cacheRead: r.usage.cacheReadInputTokens,
        output: r.usage.outputTokens,
        totalPromptTokens: r.totalPromptTokens
      }))
    },
    null,
    2
  )
);

// Use the minimum totalPromptTokens across the 3 runs as the metric:
// after the first call seeds Anthropic's cache, subsequent calls should
// stabilise at the floor. If even the minimum exceeds the budget, the
// framework prompt has genuinely grown.
const minTotal = Math.min(...results.map(r => r.totalPromptTokens));
console.log(`\nminTotalPromptTokens across ${RUNS} runs: ${minTotal}`);

if (minTotal > BUDGET) {
  console.error(
    `\n❌ Token budget exceeded: minTotal=${minTotal} > budget=${BUDGET}.\n` +
      `   Even the cache-warmest call sends more than ${BUDGET} tokens. Upstream framework prompt likely grew.`
  );
  process.exit(1);
}

console.log(`✅ Within budget: ${minTotal} <= ${BUDGET}`);
