# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

npm workspace publishing two independent packages from one repo:

- `packages/claude-code-to-llm` (`@yadimon/claude-code-to-llm`) — core SDK + CLI that wraps `claude -p` (Claude Code headless mode) for raw prompt execution.
- `packages/claude-code-to-llm-server` (`@yadimon/claude-code-to-llm-server`) — thin HTTP adapter exposing `/v1/responses`, `/v1/models`, `/healthz` (OpenAI Responses-compatible) on top of the core package. The server depends on the core package and must remain a thin adapter — put shared logic in core first.

Versioned independently with package-specific tags (`claude-code-to-llm-v<v>`, `claude-code-to-llm-server-v<v>`); see `RELEASING.md`.

## Common Commands

Run from repo root unless noted:

```bash
npm install              # workspace links + lockfile
npm run lint             # eslint flat config across the repo
npm run typecheck        # tsc -b project references, no emit
npm test                 # root node:test + each workspace's runner
npm run build            # builds both packages (dist/)
npm run verify           # lint + typecheck + test + build
npm run check            # verify + pack + publish dry-run (pre-release gate)
npm run release:check    # full local release verification including Docker e2e

npm run smoke:core       # SDK smoke (real Claude CLI)
npm run smoke:server     # boot server with stub runner
npm run start:server     # run HTTP server locally
npm run start:server:mock  # run server with built-in mock runner
npm run test:docker      # build server image and verify against live HTTP
```

Per-package (use `--workspace`):

```bash
npm run test --workspace @yadimon/claude-code-to-llm
npm run smoke:cli --workspace @yadimon/claude-code-to-llm
npm run e2e --workspace @yadimon/claude-code-to-llm
npm run e2e --workspace @yadimon/claude-code-to-llm-server
```

Run a single test file directly with tsx:

```bash
node --import tsx/esm --test packages/claude-code-to-llm/test/parse.test.ts
```

Tests use `node:test` (no jest/vitest). Test files live at `packages/*/test/*.test.ts` and `test/*.test.ts` at the root. Per-package runners are `packages/*/scripts/run-node-tests.ts`.

## Architecture

### Core package (`packages/claude-code-to-llm/src/`)

Public surface re-exported from `index.ts`. Key modules:

- `runner.ts` — `runPrompt` / `streamPrompt`. Spawns the `claude` CLI with `--print --verbose --output-format stream-json`, parses stream-json events line by line, and emits a typed `StreamEvent` async iterable (`response.started`, `response.output_text.delta`, `response.raw_event`, `response.completed`, `response.failed`). `runPrompt` is just `streamPrompt` collapsed to the final completed response. The runner owns timeout, stderr bounding, error normalization, and exit-code interpretation.
- `workspace.ts` — every run gets an isolated temp `HOME`/`USERPROFILE` populated with copies of the user's auth bundle (`~/.claude.json`, `~/.claude/.credentials.json`, optional `~/.claude/settings.json`). Caller-provided `cwd`/`configHome` are not cleaned up; auto-created ones are.
- `spawn.ts` — Windows `.cmd`/`.bat` shims and extension-less commands are wrapped through `cmd.exe /d /s /c` with proper quoting; everything else is spawned directly. Keep platform-specific behavior explicit and testable.
- `parse.ts` — stream-json line parsing, assistant text extraction, usage normalization (`input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `output_tokens` → camelCase `UsageSummary`).
- `queue.ts` — `AsyncQueue<T>` backing the streaming async iterable.
- `types.ts` — `RunOptions`, `CoreResponse`, `StreamEvent`, `Runner`, plus `DEFAULT_MODEL = "claude-sonnet-4-6"` and `DEFAULT_REASONING_EFFORT = "low"`.
- `cli-args.ts`, `cli.ts` — flag/file/stdin input handling for the binary.

The runner passes `--allowed-tools WebSearch` only when `webSearch: true`; otherwise it explicitly disallows `WebSearch`. `CLAUDE_CODE_MAX_OUTPUT_TOKENS` is set from `maxTokens`.

### Server package (`packages/claude-code-to-llm-server/src/`)

Single-file `index.ts`:

- `createServer` / `startServer` — Node `http` server, no framework. Routes: `GET /healthz`, `GET /v1/models`, `POST /v1/responses` (sync JSON or SSE when `stream: true`).
- Bearer auth applies only to `POST /v1/responses` and only when an API key is configured (`apiKey` option or `CLAUDE_CODE_TO_LLM_SERVER_API_KEY`); uses `timingSafeEqual`.
- Request body shape mirrors OpenAI Responses: `{ model, input, instructions?, stream?, reasoning.effort?, max_output_tokens? }`. `tools`, `tool_choice`, `conversation`, `previous_response_id`, `input_audio`, `input_image`, `parallel_tool_calls` are explicitly rejected.
- `serializeServerPrompt` flattens `instructions` + `input` (string, message array, or `{ messages, input }`) into a single text prompt with `## Instructions` / `## Conversation` / `## Assistant Response` sections, since the underlying `claude -p` is stateless single-turn.
- `createMockRunner` is gated on `mockMode` / `CLAUDE_CODE_TO_LLM_SERVER_MOCK_MODE` and produces synthetic `CoreResponse` events for tests and `start:mock`.
- Streaming maps core `StreamEvent`s to OpenAI SSE event names (`response.created`, `response.output_text.delta`, `response.output_text.done`, `response.completed`, `response.failed`) and ends with `data: [DONE]`.

### Auth and isolation

The wrapper never mutates the user's real `~/.claude*` files. Override sources via env or options:

- `CLAUDE_CODE_TO_LLM_AUTH_PATH` (or `authPath`) — path to `.claude.json`, the `.claude` dir, or a parent home dir.
- `CLAUDE_CODE_TO_LLM_CREDENTIALS_PATH` (`credentialsPath`)
- `CLAUDE_CODE_TO_LLM_SETTINGS_PATH` (`settingsPath`)
- `CLAUDE_CODE_TO_LLM_CONFIG_HOME` (`configHome`) — pre-built temp home; if provided, the runner will not clean it up.
- `CLAUDE_CODE_TO_LLM_CLI_PATH` — override the `claude` binary path.
- `CLAUDE_CODE_TO_LLM_WORKSPACE` — pre-built cwd; same cleanup rule.

Never commit real Claude Code auth files. `.claude-code-to-llm/`, `.codex-minimal/`, and `tmp-auth/` are local-only scratch dirs.

## Coding Conventions

ESM TypeScript only, Node `>=20`. Match existing style:

- 2-space indent, `camelCase` functions/variables, lowercase-hyphenated script filenames.
- Cover Windows and POSIX process-path assumptions whenever spawn or path handling changes.
- Add HTTP tests for both sync JSON and SSE paths when server response handling changes.
- ESLint flat config enforces `@typescript-eslint/no-explicit-any: error`. `dist/`, `node_modules/`, `.claude-code-to-llm/`, `.codex-minimal/`, `tmp-auth/`, and `**/test/fixtures/**` are ignored.

## Commits & PRs

Conventional Commits (`feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `release(<pkg>):`). PRs should include a short rationale, test evidence (`npm test` and/or `npm run release:check`), API examples for behavior changes, and notes on auth, Docker, or release implications when relevant.
