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
- installed `claude` CLI in `PATH` or `CLAUDE_CODE_TO_LLM_CLI_PATH` for the default `claude-cli` backend
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

### Claude OAuth Direct Mode

The default backend is `claude-cli`, which shells out to Claude Code in minimal headless mode. Experimental direct mode bypasses the local CLI process and sends Anthropic Messages-shaped requests with Claude Code OAuth credentials:

```bash
CLAUDE_CODE_TO_LLM_BACKEND=claude-oauth \
CLAUDE_CODE_TO_LLM_ACCEPT_DIRECT_API_CALL_RISK=1 \
npx @yadimon/claude-code-to-llm-server
```

Direct mode reads `CLAUDE_CODE_OAUTH_TOKEN` first, then falls back to `CLAUDE_CODE_TO_LLM_CREDENTIALS_PATH` or `~/.claude/.credentials.json`. The credential file is expected to contain a Claude Code `claudeAiOauth.accessToken` value. This mode is not the normal `ANTHROPIC_API_KEY` billing path; Anthropic may change, restrict, rate-limit, or block it. The confirmation variable is required so this never becomes an accidental default.

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
| `CLAUDE_CODE_TO_LLM_BACKEND` | `claude-cli` | Runner backend. Use `claude-oauth` for experimental direct subscription mode. |
| `CLAUDE_CODE_TO_LLM_ACCEPT_DIRECT_API_CALL_RISK` | - | Required value `1` when starting the CLI in `claude-oauth` mode. |
| `CLAUDE_CODE_TO_LLM_DIRECT_API_BASE_URL` | `https://api.anthropic.com` | Base URL for direct Anthropic Messages calls. |
| `CLAUDE_CODE_TO_LLM_CLAUDE_OAUTH_BASE_URL` | `https://api.anthropic.com` | Legacy alias for `CLAUDE_CODE_TO_LLM_DIRECT_API_BASE_URL`. |
| `CLAUDE_CODE_OAUTH_TOKEN` | - | Optional Claude Code OAuth token used by direct mode before reading the credentials file. |
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
- The server is a thin pass-through. Request -> runner mapping:
  - `input: "say hi"` -> prompt sent verbatim (no wrapper headers, no preamble).
  - `input: [{role, content}, ...]` -> joined with minimal `Role: content` prefixes per turn.
  - `instructions: "..."` -> forwarded as `--system-prompt` in `claude-cli` mode or Anthropic `system` in `claude-oauth` mode. Omit for the smallest possible call.
  - `web_search: true` (proprietary extension) -> enables Claude Code's WebSearch tool for the request in `claude-cli` mode. Direct mode does not expose tools.
- `--search` / `webSearch: true` at the server level is a process-wide default override; the per-request `web_search` field wins. Web-search usage is captured by the core runner but not surfaced in the OpenAI `usage` block.

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
