# @yadimon/claude-code-to-llm

Minimal SDK and CLI wrapper around Claude Code headless mode for raw prompt requests.

## Install

```bash
npm install @yadimon/claude-code-to-llm
```

Requirements:

- Node.js `>=20`
- installed `claude` CLI in `PATH` or `CLAUDE_CODE_TO_LLM_CLI_PATH`
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

## Notes

- The wrapper calls `claude --print --output-format stream-json`.
- `maxTokens` maps to `CLAUDE_CODE_MAX_OUTPUT_TOKENS` for the spawned Claude Code process.
- The package is intentionally focused on raw prompt execution. It does not expose Claude Code tools through its public API.
- Web search is off by default. Enable per-call with `webSearch: true` (SDK) or `--search` (CLI).
- Requires Claude Code CLI `>= 2.1.0`. The runner detects the version on first call and fails with an upgrade hint if it's older — install or refresh via `npm i -g @anthropic-ai/claude-code`.

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
