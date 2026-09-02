# Repository Guidelines

Canonical guidance for humans and coding agents working in this repository. `CLAUDE.md` imports this file.

## Workspace shape

npm workspaces monorepo (`workspaces: ["packages/*"]`, `type: "module"`, Node `>=20`). The root is private and owns the single lockfile. Two publishable packages:

- `packages/claude-code-to-llm` (`@yadimon/claude-code-to-llm`) — core SDK + CLI that wraps `claude -p` (Claude Code headless mode) for raw prompt execution. All shared logic lives here.
- `packages/claude-code-to-llm-server` (`@yadimon/claude-code-to-llm-server`) — thin HTTP adapter exposing `/healthz`, `/v1/models`, `/v1/responses` (OpenAI Responses-compatible, sync + SSE). Depends on core via a `^` range that is bumped automatically on core releases.
- `scripts/` — root helpers for workspace tests, release checks, and published-package smokes.
- `.claude-code-to-llm/`, `.codex-minimal/`, `tmp-auth/` — local auth or scratch directories; never commit them.

When adding behavior, put it in core first. The server package stays a transport/adapter layer.

## Commands

Root (runs across both workspaces):

```bash
npm install                 # workspace links + single root lockfile
npm run lint                # flat ESLint config (@typescript-eslint/no-explicit-any: error)
npm run typecheck           # tsc -b project references, no emit
npm test                    # root repo tests + each workspace's test and e2e scripts
npm run build               # builds both packages (core dist/ must exist before server)
npm run verify              # lint + typecheck + test + build (PR gate)
npm run check               # verify + pack + publish:dry-run (pre-release gate)
npm run release:check       # full release readiness incl. Docker e2e
npm run test:docker         # build the server image and verify against live HTTP

npm run smoke:core          # SDK smoke against the real claude CLI
npm run smoke:server        # boot the server with a stub runner
npm run smoke:vision        # image input through core and server (real CLI)
npm run smoke:tokens        # token-usage smoke (real CLI)
npm run smoke:published     # clean-install the published core and server packages
npm run start:server        # run the HTTP server locally
npm run start:server:mock   # run the server with the built-in mock runner
```

Per package (`npm run <script> --workspace <name>` or `cd packages/<name>`): `test`, `e2e`, `lint`, `typecheck`, `build`, `pack`, `publish:dry-run`, `smoke:*`. A single test file: `node --import tsx/esm --test packages/claude-code-to-llm/test/parse.test.ts`.

## Architecture

### Core package (`packages/claude-code-to-llm/src/`)

Public surface is re-exported from `index.ts`.

- `runner.ts` — `runPrompt` / `streamPrompt`. Spawns the `claude` CLI with `--print --verbose --output-format stream-json`, parses stream-json events line by line, and emits a typed `StreamEvent` async iterable (`response.started`, `response.output_text.delta`, `response.raw_event`, `response.completed`, `response.failed`). `runPrompt` is `streamPrompt` collapsed to the final response. The runner owns timeout, stderr bounding, error normalization, and exit-code interpretation.
- `workspace.ts` — every run gets an isolated temp `HOME`/`USERPROFILE` with a minimal Claude home: an empty `.claude.json`, a copied `~/.claude/.credentials.json`, and an empty MCP config. User settings are copied only when `settingsPath` is explicitly provided. Caller-provided `cwd`/`configHome` are not cleaned up; auto-created ones are.
- `spawn.ts`, `platform.ts` — process spawning and CLI resolution. On Windows, extension-less commands are first upgraded to a real `.exe` when one exists (sibling probe for explicit paths, PATH probe for bare commands) and spawned directly; remaining `.cmd`/`.bat` shims go through `cmd.exe /d /s /c` with cmd-specific quoting and `windowsVerbatimArguments`, and args containing newlines are rejected on that path. Use the first usable candidate in PATH order; never replace a working shim with a WindowsApps executable just because one exists. `platform.ts` also enforces `MIN_CLAUDE_VERSION` (`assertClaudeVersion`).
- `images.ts` — image input normalization for `--image` / `images`: local paths, HTTPS URLs, and data URLs, turned into Anthropic image blocks by `createMultimodalContent`. Enforces supported media types with signature detection (`detectImageMediaType`), `MAX_IMAGE_COUNT`, per-image base64 and total byte caps. Do not weaken these when extending image support.
- `direct-api.ts` — `createDirectApiRunner` / `runDirectApiPrompt` / `streamDirectApiPrompt` call the API directly instead of spawning the CLI. Risk-gated: the CLI requires `--accept-direct-api-call-risk` or `CLAUDE_CODE_TO_LLM_ACCEPT_DIRECT_API_CALL_RISK=1`; subscription-backed direct calls have their own gate (`CLAUDE_CODE_TO_LLM_ACCEPT_SUBSCRIPTION_DIRECT_RISK`).
- `parse.ts` — stream-json parsing, assistant text extraction, usage normalization (`input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `output_tokens` → camelCase `UsageSummary`).
- `queue.ts` (`AsyncQueue<T>`), `types.ts` (`RunOptions`, `CoreResponse`, `StreamEvent`, `Runner`, `DEFAULT_MODEL`, `DEFAULT_REASONING_EFFORT = "low"`), `cli-args.ts`, `cli.ts`.

Key invariants:

- The runner passes `--tools WebSearch` only when `webSearch: true`, otherwise `--tools ""`. It always forces `--safe-mode`, `--no-chrome`, `--no-session-persistence`, `--disable-slash-commands`, `--strict-mcp-config`, and an empty MCP config. `CLAUDE_CODE_MAX_OUTPUT_TOKENS` is set from `maxTokens`.
- When images are present the prompt is sent as a stream-json user message (`--input-format stream-json`) carrying text plus image blocks; otherwise it is plain text.
- The wrapper never mutates the user's real `~/.claude*` files.
- Headless behavior depends on the Claude home in use: user-global extensions, plugins, or settings can change results and make a package failure look like an input failure. Run live checks with the repository's isolated home, not the developer's global one.

### Server package (`packages/claude-code-to-llm-server/src/`)

- `index.ts` — `createServer` / `startServer` on Node `http`, no framework; `cli.ts` is the binary. Routes: `GET /healthz`, `GET /v1/models`, `POST /v1/responses` (sync JSON, or SSE when `stream: true`).
- Backend selection (`CLAUDE_CODE_TO_LLM_BACKEND` / `backend` option): `claude-cli` (default, spawns the CLI through core) or `claude-oauth` (direct API path).
- Bearer auth applies only to `POST /v1/responses` and only when an API key is configured (`apiKey` / `CLAUDE_CODE_TO_LLM_SERVER_API_KEY`); comparison uses `timingSafeEqual` on length-equal buffers.
- Request body mirrors OpenAI Responses: `{ model, input, instructions?, stream?, reasoning.effort?, max_output_tokens? }`. These **top-level** fields are rejected up front (`UNSUPPORTED_REQUEST_FIELDS`): `tools`, `tool_choice`, `conversation`, `previous_response_id`, `input_audio`, `input_image`, `parallel_tool_calls`. Extend the list deliberately.
- Image input is accepted as `input_image` **content blocks inside user messages** and forwarded to core as `images`; it is rejected outside user messages.
- `serializeServerPrompt` flattens `instructions` + `input` (string, message array, or `{ messages, input }`) into one text prompt with `## Instructions` / `## Conversation` / `## Assistant Response` sections, because `claude -p` is stateless single-turn. It lives in the server on purpose — the flattening is Responses-specific and must not leak into core.
- `createMockRunner` is gated on `mockMode` / `CLAUDE_CODE_TO_LLM_SERVER_MOCK_MODE` and produces synthetic `CoreResponse` events for tests and `start:server:mock`.
- SSE maps core `StreamEvent`s to `response.created`, `response.output_text.delta`, `response.output_text.done`, `response.completed`, `response.failed`, and ends with `data: [DONE]`.

### Environment variables

Core: `CLAUDE_CODE_TO_LLM_AUTH_PATH`, `CLAUDE_CODE_TO_LLM_CREDENTIALS_PATH`, `CLAUDE_CODE_TO_LLM_SETTINGS_PATH`, `CLAUDE_CODE_TO_LLM_CONFIG_HOME`, `CLAUDE_CODE_TO_LLM_LOCAL_HOME`, `CLAUDE_CODE_TO_LLM_CLI_PATH`, `CLAUDE_CODE_TO_LLM_WORKSPACE`, `CLAUDE_CODE_TO_LLM_REASONING_EFFORT`, `CLAUDE_CODE_MAX_OUTPUT_TOKENS` (derived from `maxTokens`).

Direct API / OAuth: `CLAUDE_CODE_TO_LLM_ACCEPT_DIRECT_API_CALL_RISK`, `CLAUDE_CODE_TO_LLM_ACCEPT_SUBSCRIPTION_DIRECT_RISK`, `CLAUDE_CODE_TO_LLM_DIRECT_API_BASE_URL`, `CLAUDE_CODE_TO_LLM_CLAUDE_OAUTH_BASE_URL`.

Server: `CLAUDE_CODE_TO_LLM_BACKEND`, `CLAUDE_CODE_TO_LLM_SERVER_HOST`, `CLAUDE_CODE_TO_LLM_SERVER_PORT`, `CLAUDE_CODE_TO_LLM_SERVER_API_KEY`, `CLAUDE_CODE_TO_LLM_SERVER_MODELS` (CSV), `CLAUDE_CODE_TO_LLM_SERVER_DEFAULT_MODEL`, `CLAUDE_CODE_TO_LLM_SERVER_MOCK_MODE`, `CLAUDE_CODE_TO_LLM_SERVER_MOCK_RESPONSE`, plus all core vars.

## Auth and isolation

Override sources via env or options:

- `CLAUDE_CODE_TO_LLM_AUTH_PATH` (`authPath`) — path to `.claude.json`, the `.claude` dir, or a parent home dir.
- `CLAUDE_CODE_TO_LLM_CREDENTIALS_PATH` (`credentialsPath`).
- `CLAUDE_CODE_TO_LLM_SETTINGS_PATH` (`settingsPath`) — opt-in only; omitted by default to avoid loading user MCP/plugin/settings state.
- `CLAUDE_CODE_TO_LLM_CONFIG_HOME` (`configHome`) — pre-built temp home; the runner will not clean it up.
- `CLAUDE_CODE_TO_LLM_CLI_PATH` — override the `claude` binary path.
- `CLAUDE_CODE_TO_LLM_WORKSPACE` — pre-built cwd; same cleanup rule.

Never commit real Claude Code auth files. Prefer `CLAUDE_CODE_TO_LLM_AUTH_PATH`, `CLAUDE_CODE_TO_LLM_CREDENTIALS_PATH`, `npm run auth:copy --workspace @yadimon/claude-code-to-llm`, or locally mounted secrets for Docker runs. `.claude-code-to-llm/`, `.codex-minimal/`, and `tmp-auth/` stay untracked.

## Testing

- `node:test` only (no jest/vitest). Files at `packages/*/test/*.test.ts` and `test/*.test.ts` at the root; runners are `scripts/run-root-node-tests.ts` and `packages/*/scripts/run-node-tests.ts`, and they must propagate failures through the process exit code (the root repo test asserts this).
- Fixtures in `packages/claude-code-to-llm/test/fixtures/` (`fake-claude.mjs`, `fake-claude.cmd`) stand in for the real `claude` binary and are excluded from ESLint. `fake-claude.mjs` is executed directly on Linux CI, so it must stay tracked as executable (`git ls-files -s` shows `100755`); the root repo test asserts this.
- Name tests after observable behavior.
- Process-path / spawn changes must keep both Windows and POSIX assertions passing.
- HTTP behavior changes need both sync JSON and SSE coverage.
- Vision smokes use an embedded, visually unambiguous image so results are deterministic; an external image URL is an optional network-path check, never the only fixture.
- Live lanes (`smoke:core`, `smoke:vision`, `smoke:tokens`, per-package `smoke:cli` / `smoke:search`) need real Claude auth and are not part of `npm test`.

## Style

- ESM TypeScript only, Node `>=20`. 2-space indent, `camelCase` functions/variables, lowercase-hyphenated script filenames.
- `@typescript-eslint/no-explicit-any` is an error — type things properly rather than disabling. `dist/`, `node_modules/`, `.claude-code-to-llm/`, `.codex-minimal/`, `tmp-auth/`, and `**/test/fixtures/**` are lint-ignored.
- Keep platform-specific process behavior explicit and testable.

## Commits and pull requests

Conventional Commits (`feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `release(<pkg>):`).

PRs include a short rationale, test evidence (`npm test` and/or `npm run release:check`), API examples when request/response behavior changes, and notes on auth, Docker, or release implications when relevant. Run `npm test` before opening a PR.

## Releases

Two independently versioned packages with package-specific tags (`claude-code-to-llm-v<version>`, `claude-code-to-llm-server-v<version>`). `npm run release:core:*` / `release:server:*` run `check`, bump the selected workspace, auto-update the server's core dependency on core releases, commit, tag, and push. GitHub Actions (`.github/workflows/publish.yml`) publishes only the package matching the pushed tag via Trusted Publishing (OIDC). The full flow, including pre-release and post-publish verification, is in `RELEASING.md`.
