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
- Web search is off by default. The wrapper always forces the `WebSearch` permission via `--allowed-tools WebSearch` (when `webSearch: true` / `--search`) or `--disallowed-tools WebSearch`, overriding any `WebSearch` entry in `settings.json`.

## Development

```bash
npm run build --workspace @yadimon/claude-code-to-llm
npm run lint --workspace @yadimon/claude-code-to-llm
npm run typecheck --workspace @yadimon/claude-code-to-llm
```
