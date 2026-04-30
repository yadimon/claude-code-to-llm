# @yadimon/claude-code-to-llm-server

OpenAI-compatible Responses server on top of `@yadimon/claude-code-to-llm`.

## Install

```bash
npm install -g @yadimon/claude-code-to-llm-server
```

Or run it without installing globally:

```bash
npx @yadimon/claude-code-to-llm-server
```

Requirements:

- Node.js `>=20`
- installed `claude` CLI in `PATH` or `CLAUDE_CODE_TO_LLM_CLI_PATH`
- valid Claude Code login on the machine

Default auth bundle:

- `~/.claude.json`
- `~/.claude/.credentials.json`

## Endpoints

- `POST /v1/responses`
- `GET /v1/models`
- `GET /healthz`

## Start

```bash
npx @yadimon/claude-code-to-llm-server
```

Then call:

```bash
curl http://127.0.0.1:3000/healthz
curl http://127.0.0.1:3000/v1/models
```

Example response request:

```bash
curl http://127.0.0.1:3000/v1/responses \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-6",
    "input": "Say hello in one short sentence."
  }'
```

Streaming example:

```bash
curl http://127.0.0.1:3000/v1/responses \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-6",
    "stream": true,
    "input": "Count from 1 to 3."
  }'
```

Local development commands:

```bash
npm run start --workspace @yadimon/claude-code-to-llm-server
npm run start:mock --workspace @yadimon/claude-code-to-llm-server
```

## Authentication

If you set `CLAUDE_CODE_TO_LLM_SERVER_API_KEY`, only `POST /v1/responses` requires a bearer token. `GET /healthz` and `GET /v1/models` stay public.

Example:

```bash
curl http://127.0.0.1:3000/v1/responses \
  -H "Authorization: Bearer your-token" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-6",
    "input": "Hello"
  }'
```

## Runtime Configuration

| Variable | Default | Description |
|---|---|---|
| `CLAUDE_CODE_TO_LLM_SERVER_HOST` | `127.0.0.1` | HTTP bind host. |
| `CLAUDE_CODE_TO_LLM_SERVER_PORT` | `3000` | HTTP bind port. |
| `CLAUDE_CODE_TO_LLM_SERVER_DEFAULT_MODEL` | `claude-sonnet-4-6` | Fallback model when the request omits `model`. |
| `CLAUDE_CODE_TO_LLM_SERVER_MODELS` | default model | Comma-separated allowlist of accepted models. |
| `CLAUDE_CODE_TO_LLM_SERVER_API_KEY` | - | Bearer token accepted for `POST /v1/responses`. |
| `CLAUDE_CODE_TO_LLM_SERVER_MOCK_MODE` | - | Enables the mock runner for local testing. |
| `CLAUDE_CODE_TO_LLM_SERVER_MOCK_RESPONSE` | `mock response` | Mock response text returned by the mock runner. |
| `CLAUDE_CODE_TO_LLM_AUTH_PATH` | `~/.claude.json` | Path to the Claude Code session file. |
| `CLAUDE_CODE_TO_LLM_CREDENTIALS_PATH` | `~/.claude/.credentials.json` | Path to the Claude Code credentials file. |
| `CLAUDE_CODE_TO_LLM_SETTINGS_PATH` | `~/.claude/settings.json` when present | Optional settings file copied into the temporary Claude home. |
| `CLAUDE_CODE_TO_LLM_CLI_PATH` | `claude` | Path to the Claude Code CLI binary. |
| `CLAUDE_CODE_TO_LLM_CONFIG_HOME` | temp dir | Temporary Claude Code home directory for a run. |
| `CLAUDE_CODE_TO_LLM_WORKSPACE` | temp dir | Workspace directory used for execution. |
| `CLAUDE_CODE_TO_LLM_REASONING_EFFORT` | `low` | Default reasoning effort passed to the core runner. |

## Behavior Notes

- `GET /healthz` and `GET /v1/models` stay public even when bearer auth is configured.
- `POST /v1/responses` validates requested models against `CLAUDE_CODE_TO_LLM_SERVER_MODELS`.
- `max_output_tokens` and `reasoning.effort` are forwarded to the core runner.
- Unsupported request fields such as `tools`, `tool_choice`, or `input_image` return `400`.
- The server owns prompt adaptation for `instructions` and multi-message dialog input before calling the raw core runner.
- `--search` / `webSearch: true` is a server-wide policy: when enabled it allows the underlying `claude` CLI to use `WebSearch` for every request. There is no per-request opt-in (`tools` is rejected). Web-search usage is captured by the core runner but not surfaced in the OpenAI `usage` block.

## Docker

Build from the repository root:

```bash
docker build -f packages/claude-code-to-llm-server/Dockerfile .
docker run -p 3000:3000 \
  -v ~/.claude.json:/root/.claude.json:ro \
  -v ~/.claude/.credentials.json:/root/.claude/.credentials.json:ro \
  claude-code-to-llm-server
```

## Development

```bash
npm run build --workspace @yadimon/claude-code-to-llm-server
npm run lint --workspace @yadimon/claude-code-to-llm-server
npm run typecheck --workspace @yadimon/claude-code-to-llm-server
```
