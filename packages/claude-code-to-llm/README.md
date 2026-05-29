# @yadimon/claude-code-to-llm

Minimal SDK and CLI wrapper around Claude Code headless mode for raw prompt requests.

## Install

```bash
npm install @yadimon/claude-code-to-llm
```

Requirements:

- Node.js `>=20`
- installed `claude` CLI in `PATH` or `CLAUDE_CODE_TO_LLM_CLI_PATH` for the default CLI-backed mode
- valid Claude Code login on the machine

The wrapper defaults to the Claude Code auth bundle at:

- `~/.claude.json`
- `~/.claude/.credentials.json`

If you need to verify that Claude Code is currently logged in, run:

```bash
claude auth status
```

## What It Provides

- a small SDK for raw prompt execution with minimal prompt overhead
- a CLI for direct prompt mode from flags, files, or stdin
- structured streaming events for adapters such as HTTP compatibility servers
- isolated execution via a temporary home directory copied from your Claude Code auth bundle
- an explicit `--direct-api-call` escape hatch that bypasses the Claude Code CLI process after risk confirmation

## SDK

```ts
import { runPrompt } from "@yadimon/claude-code-to-llm";

const result = await runPrompt("Hello", {
  model: "claude-sonnet-4-6",
  maxTokens: 256
});

console.log(result.content);
console.log(result.usage);
```

For streamed events:

```ts
import { streamPrompt } from "@yadimon/claude-code-to-llm";

for await (const event of streamPrompt("Hello", {
  model: "claude-sonnet-4-6"
})) {
  if (event.type === "response.output_text.delta") {
    process.stdout.write(event.delta);
  }
}
```

## CLI

```bash
claude-code-to-llm --prompt "Hello"
claude-code-to-llm --input-file ./prompt.txt --json
cat ./prompt.txt | claude-code-to-llm --stream --json
```

Supported CLI options:

```text
--prompt <text>
--input-file <path>
--stream
--json
--model <name>
--reasoning-effort <level>
--max-tokens <n>
--search
--direct-api-call
--accept-direct-api-call-risk
--direct-api-base-url <url>
--auth-path <path>
--credentials-path <path>
--settings-path <path>
--config-home <path>
--cwd <path>
--cli <path>
```

## Runtime Configuration

| Variable | Default | Description |
|---|---|---|
| `CLAUDE_CODE_TO_LLM_AUTH_PATH` | `~/.claude.json` | Path to the Claude Code session file. |
| `CLAUDE_CODE_TO_LLM_CREDENTIALS_PATH` | `~/.claude/.credentials.json` | Path to the Claude Code credentials file. |
| `CLAUDE_CODE_TO_LLM_SETTINGS_PATH` | `~/.claude/settings.json` when present | Optional Claude Code settings file to copy into the temp home. |
| `CLAUDE_CODE_TO_LLM_CLI_PATH` | `claude` | Path to the Claude Code CLI binary. |
| `CLAUDE_CODE_TO_LLM_REASONING_EFFORT` | `low` | Default reasoning effort passed to Claude Code. |
| `CLAUDE_CODE_TO_LLM_CONFIG_HOME` | temp dir | Temporary Claude Code home directory for a run. |
| `CLAUDE_CODE_TO_LLM_WORKSPACE` | temp dir | Workspace directory used for execution. |
| `CLAUDE_CODE_TO_LLM_LOCAL_HOME` | `.claude-code-to-llm/` | Local directory used by the auth copy helper. |
| `CLAUDE_CODE_TO_LLM_ACCEPT_DIRECT_API_CALL_RISK` | - | Required value `1` to use `--direct-api-call` without passing `--accept-direct-api-call-risk`. |
| `CLAUDE_CODE_TO_LLM_DIRECT_API_BASE_URL` | `https://api.anthropic.com` | Base URL for experimental direct Messages calls. |
| `CLAUDE_CODE_OAUTH_TOKEN` | - | Optional Claude Code OAuth token used by direct mode before reading the credentials file. |

## Notes

- The wrapper calls `claude --print --output-format stream-json`.
- `maxTokens` maps to `CLAUDE_CODE_MAX_OUTPUT_TOKENS` for the spawned Claude Code process.
- The package is intentionally focused on raw prompt execution. It does not expose Claude Code tools through its public API.
- Web search is off by default. Enable per-call with `webSearch: true` (SDK) or `--search` (CLI).
- Requires Claude Code CLI `>= 2.1.0`. The runner detects the version on first call and fails with an upgrade hint if it's older — install or refresh via `npm i -g @anthropic-ai/claude-code`.

## Direct API Call Mode

`--direct-api-call` is an explicit, off-by-default bypass for the local Claude Code CLI process. It maps the prompt to Anthropic's Messages endpoint with Claude Code OAuth credentials and returns the same SDK/CLI response shape. It does not create a temp repo, does not run `claude --print`, and does not add Claude Code tool or slash-command context.

For Claude Code OAuth compatibility, direct mode sends a short Claude-Code-style transport identity block in `system[]`:

```json
{ "type": "text", "text": "You are Claude Code, Anthropic's official CLI for Claude." }
```

It does not send Claude Code's full agent prompt, project context, tool schemas, slash-command metadata, or dynamic cwd/git/memory sections.

You must confirm the risk every time with a flag, or set the confirmation environment variable once for a shell/session:

```bash
claude-code-to-llm \
  --direct-api-call \
  --accept-direct-api-call-risk \
  --prompt "Translate to German: Good morning" \
  --max-tokens 80
```

```powershell
$env:CLAUDE_CODE_TO_LLM_ACCEPT_DIRECT_API_CALL_RISK = "1"
npx @yadimon/claude-code-to-llm --direct-api-call --prompt "Translate to German: Good morning"
```

Direct mode reads auth in this order:

1. `CLAUDE_CODE_OAUTH_TOKEN`
2. `CLAUDE_CODE_TO_LLM_CREDENTIALS_PATH`
3. `~/.claude/.credentials.json`

Use `claude setup-token` if you need a long-lived OAuth token for scripts. Do not expose a direct-mode process to untrusted users or networks.

### Parallel Translation Example

For many tiny translation/classification calls, direct mode can be useful because it avoids starting the Claude Code agent harness for each element. A typical pattern is to confirm the risk once, then have Claude Code fan out multiple small direct calls:

```powershell
$env:CLAUDE_CODE_TO_LLM_ACCEPT_DIRECT_API_CALL_RISK = "1"
claude -p "Run 20 translation tasks in parallel. For each element, call: npx @yadimon/claude-code-to-llm --direct-api-call --max-tokens 120 --json --prompt '<translate this one element to German, preserving placeholders>'. Return a JSON array in the original order."
```

If your account supports a weaker/faster model, pass it explicitly:

```bash
npx @yadimon/claude-code-to-llm \
  --direct-api-call \
  --accept-direct-api-call-risk \
  --model <weak-translation-model> \
  --max-tokens 120 \
  --prompt "Translate to German: Reset password"
```

### Policy and Proxy Source Notes

This feature is intentionally described as experimental. Anthropic's Consumer Terms prohibit automated or non-human access except through an Anthropic API key or explicit permission, and prohibit account sharing/resale. Claude Code's own docs document bearer-token auth, `CLAUDE_CODE_OAUTH_TOKEN`, and LLM gateways/proxies for Claude Code CLI use. That is not the same as Anthropic endorsing subscription OAuth as a general third-party API proxy surface.

Relevant source links:

- Anthropic Consumer Terms: https://www.anthropic.com/legal/consumer-terms
- Claude Code authentication docs: https://code.claude.com/docs/en/authentication
- Claude Code proxy/gateway docs: https://code.claude.com/docs/en/bedrock-vertex-proxies
- OmniRoute marks Claude Code OAuth as subscription-risk: https://raw.githubusercontent.com/diegosouzapw/OmniRoute/main/src/shared/constants/providers.ts
- Public reporting on Anthropic cutting off third-party harness subscription coverage: https://techcrunch.com/2026/04/04/anthropic-says-claude-code-subscribers-will-need-to-pay-extra-for-openclaw-support/

## Minimal Mode (always on, since 0.5)

`runPrompt` / `streamPrompt` always spawn `claude` in **minimal mode** — every Claude Code framework feature that isn't required for a one-shot LLM call is stripped before the prompt is sent. There is no toggle; this is the package's reason to exist.

Measured floor on `claude-sonnet-4-6` with a 3-token user prompt and OAuth/subscription auth: **~2k input tokens** (almost entirely cache-creation on the first call, hits cache-read on subsequent calls within the TTL). Down from ~42k on a full Claude Code session.

Flags forced on every call:

- `--tools ""` — strip every built-in tool schema (Read, Edit, Write, Bash, Glob, Grep, …). When `webSearch: true`, `--tools WebSearch` instead.
- `--disable-slash-commands` — keep `/skill` metadata out of context.
- `--system-prompt ""` (or your `systemPrompt` value) — replace the default "You are Claude Code…" preset. This also disables the dynamic cwd/env/git/memory sections (they're tied to the default preset).
- `--no-session-persistence` — every call is isolated.

What stays on:

- **OAuth / subscription auth.** The package never passes `--bare`, which would force `ANTHROPIC_API_KEY` and bypass the keychain.
- `webSearch: true` opts WebSearch back in for individual calls.

### Custom system prompt

Pass `systemPrompt` to replace the empty default with your own instructions:

```ts
await runPrompt(userMessage, {
  systemPrompt: "Du bist ein deutscher Klassifikator. Antworte als JSON {\"tags\": [...]}."
});
```

There is no `appendSystemPrompt` option — appending would re-attach Claude Code's heavy default preset, defeating minimal mode. Build your own full prompt string instead.

### Verifying the token budget

`npm run smoke:tokens` runs the same `say hi` prompt 3 times and reports a per-call usage breakdown (input / cacheCreate / cacheRead / output). It asserts that the **minimum** `inputTokens + cacheCreationInputTokens + cacheReadInputTokens` across the 3 runs stays under a budget (default `8000`, tune via `SMOKE_TOKENS_BUDGET`).

Observed today on `claude-sonnet-4-6` with subscription auth: ~7.4k tokens/call. Note that `cacheRead` is consistently `0` even across identical back-to-back calls — Claude Code's `-p / --print` flow does not appear to reuse Anthropic's prompt cache. The floor varies over days/sessions, likely driven by Anthropic-side framework prompt changes.

## Development

```bash
npm run build --workspace @yadimon/claude-code-to-llm
npm run lint --workspace @yadimon/claude-code-to-llm
npm run typecheck --workspace @yadimon/claude-code-to-llm
```
