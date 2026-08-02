# @yadimon/claude-code-to-llm-server

Expose a logged-in Claude Code CLI through a small OpenAI Responses-compatible HTTP server with text, vision, and SSE streaming.

The server is a thin adapter over [`@yadimon/claude-code-to-llm`](https://github.com/yadimon/claude-code-to-llm/tree/main/packages/claude-code-to-llm). The default backend runs each request through an isolated, tool-free Claude Code process. It is useful when an existing local application already speaks the Responses API or when several trusted processes need one local endpoint.

> [!IMPORTANT]
> Compatibility is intentionally narrow: `POST /v1/responses`, `GET /v1/models`, and `GET /healthz`. This is not a drop-in implementation of the complete OpenAI API, Chat Completions, tool calling, files, conversations, or background responses.

## Install and Start

```bash
npm install -g @yadimon/claude-code-to-llm-server
claude-code-to-llm-server
```

Or run without a global install:

```bash
npx @yadimon/claude-code-to-llm-server
```

Requirements for the default backend:

- Node.js 20 or newer
- Claude Code CLI 2.1.179 or newer in `PATH`
- a working Claude Code login on the server machine (`claude auth status`)

The default address is `http://127.0.0.1:3000`.

## First Request

This Node.js example requires no client dependency:

```js
const response = await fetch("http://127.0.0.1:3000/v1/responses", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "claude-sonnet-4-6",
    input: "Say hello in one short sentence."
  })
});

if (!response.ok) {
  throw new Error(`${response.status}: ${await response.text()}`);
}

console.log((await response.json()).output_text);
```

Health and model discovery:

```bash
curl http://127.0.0.1:3000/healthz
curl http://127.0.0.1:3000/v1/models
```

## Use an OpenAI Responses Client

Clients that let you set a base URL can call the supported subset. With the official `openai` npm package:

```js
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.LOCAL_LLM_API_KEY ?? "local-only",
  baseURL: "http://127.0.0.1:3000/v1"
});

const response = await client.responses.create({
  model: "claude-sonnet-4-6",
  instructions: "Answer concisely.",
  input: "Why is the sky blue?",
  max_output_tokens: 200
});

console.log(response.output_text);
```

Only use fields listed below. Client helpers for conversations, tools, files, audio, or other OpenAI endpoints will not work against this server.

## Vision

Use a nested Responses `input_image` content block. `image_url` may contain an HTTPS URL or a `data:image/...;base64,...` URL.

```js
import { readFile } from "node:fs/promises";

const base64 = await readFile("./screenshot.png", "base64");
const response = await fetch("http://127.0.0.1:3000/v1/responses", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "claude-sonnet-4-6",
    input: [{
      role: "user",
      content: [
        {
          type: "input_image",
          image_url: `data:image/png;base64,${base64}`
        },
        {
          type: "input_text",
          text: "Describe the UI and identify its primary action."
        }
      ]
    }]
  })
});

console.log((await response.json()).output_text);
```

JPEG, PNG, GIF, and WebP are supported. Local paths and `file_id` are rejected because a remote client must not be able to read arbitrary files from the server. Encode local client files as data URLs instead. The optional `detail` field accepts `auto`, `low`, or `high`, but currently has no distinct Claude mapping.

The core limits apply: at most 100 images, 10 MiB of encoded base64 per image, and 20 MiB of encoded base64 across embedded images. The complete HTTP body is capped at 32 MiB. HTTPS URL downloads remain subject to Anthropic's downloader and network policy.

## Streaming

Set `stream: true` to receive server-sent events (SSE):

```js
const response = await fetch("http://127.0.0.1:3000/v1/responses", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "claude-sonnet-4-6",
    stream: true,
    input: "Count from one to three."
  })
});

for await (const chunk of response.body) {
  process.stdout.write(new TextDecoder().decode(chunk));
}
```

The stream emits `response.created`, `response.output_text.delta`, `response.output_text.done`, and `response.completed`, followed by `data: [DONE]`. Failures after streaming begins are sent as `response.failed` events.

## Supported Responses Subset

| Surface | Support | Notes |
| --- | --- | --- |
| `input: "..."` | Yes | Sent verbatim as a one-turn prompt. |
| message arrays | Yes | Text blocks and `system`, `developer`, `user`, or `assistant` roles. |
| nested `input_image` | Yes | User messages only; HTTPS or data URL. |
| `instructions` | Yes | Becomes the runner's replacement system prompt. |
| `model` | Yes | Must be in the configured model allowlist. |
| `max_output_tokens` | Yes | Positive integer. |
| `reasoning.effort` | Yes | `low`, `medium`, `high`, or `max`. |
| `stream` | Yes | SSE normalized to a small Responses event set. |
| `web_search` | Yes, extension | Proprietary boolean; CLI backend only. |
| `tools`, `tool_choice` | No | Rejected with HTTP 400. |
| `conversation`, `previous_response_id` | No | Every request is isolated. |
| audio, top-level `input_image`, `parallel_tool_calls` | No | Rejected with HTTP 400. |
| `/v1/chat/completions` and other OpenAI routes | No | Only the listed endpoints exist. |

Multi-turn message arrays are serialized into one prompt with minimal `Role: content` prefixes. They do not create a durable Claude conversation. Responses contain one assistant text message plus normalized usage; function calls and other output item types are not produced.

## Authentication and Network Safety

The server binds to `127.0.0.1` by default and has no HTTP authentication until you configure it. For a bearer token, prefer the environment variable so the secret is not visible in the process command line:

PowerShell:

```powershell
$env:CLAUDE_CODE_TO_LLM_SERVER_API_KEY = "replace-with-a-long-random-secret"
npx @yadimon/claude-code-to-llm-server
```

Bash:

```bash
export CLAUDE_CODE_TO_LLM_SERVER_API_KEY="replace-with-a-long-random-secret"
npx @yadimon/claude-code-to-llm-server
```

Then send:

```text
Authorization: Bearer replace-with-a-long-random-secret
```

The bearer token protects only `POST /v1/responses`. `/healthz` and `/v1/models` remain public. The server has no TLS, CORS policy, user accounts, rate limiter, request queue, quota, or audit log. Before binding beyond loopback, put it behind a trusted TLS reverse proxy, configure the bearer token, limit network access, and add concurrency/rate limits suitable for your account.

The process can read the Claude Code credentials of its OS user. Run it only on a machine and account you control, never bake auth files into an image, and do not expose it as a public subscription-sharing service.

The Claude CLI backend inherits the server process environment, so Claude Code's normal authentication precedence still applies. An approved `ANTHROPIC_API_KEY`, for example, can take precedence over subscription OAuth. Remove unintended provider credentials and check `claude auth status` when the billing/auth route matters.

## Backends

| Backend | Status | Transport | Important limits |
| --- | --- | --- | --- |
| `claude-cli` | Default | Spawns the local Claude Code CLI in minimal mode | Process startup per request; supports opt-in `web_search` and vision. |
| `claude-oauth` | Experimental | Calls an Anthropic Messages-compatible endpoint with Claude Code OAuth | Requires explicit risk acknowledgement; no web search; may be changed, restricted, rate-limited, or blocked upstream. |

Start experimental direct mode in PowerShell:

```powershell
$env:CLAUDE_CODE_TO_LLM_BACKEND = "claude-oauth"
$env:CLAUDE_CODE_TO_LLM_ACCEPT_DIRECT_API_CALL_RISK = "1"
npx @yadimon/claude-code-to-llm-server
```

Or in Bash:

```bash
CLAUDE_CODE_TO_LLM_BACKEND=claude-oauth \
CLAUDE_CODE_TO_LLM_ACCEPT_DIRECT_API_CALL_RISK=1 \
npx @yadimon/claude-code-to-llm-server
```

Direct mode reads `CLAUDE_CODE_OAUTH_TOKEN` first, then `CLAUDE_CODE_TO_LLM_CREDENTIALS_PATH`, then `~/.claude/.credentials.json`. It is not the normal `ANTHROPIC_API_KEY` billing path. Review [Anthropic's Consumer Terms](https://www.anthropic.com/legal/consumer-terms) for your use case and never expose this backend to untrusted callers.

## Web Search Extension

The default CLI backend keeps every Claude Code tool disabled unless search is explicitly enabled. Enable it for a single request:

```json
{
  "model": "claude-sonnet-4-6",
  "input": "Find the current Node.js LTS release and cite the source.",
  "web_search": true
}
```

`--search` on the server CLI makes search the process-wide default; an explicit per-request `web_search` value wins. Search usage is retained by the core runner but is not currently surfaced in the OpenAI-shaped `usage` object. `claude-oauth` rejects `web_search: true`.

## Runtime Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `CLAUDE_CODE_TO_LLM_SERVER_HOST` | `127.0.0.1` | HTTP bind host. |
| `CLAUDE_CODE_TO_LLM_SERVER_PORT` | `3000` | HTTP port. |
| `CLAUDE_CODE_TO_LLM_SERVER_DEFAULT_MODEL` | `claude-sonnet-4-6` | Model used when a request omits `model`. |
| `CLAUDE_CODE_TO_LLM_SERVER_MODELS` | default model | Comma-separated accepted-model allowlist. |
| `CLAUDE_CODE_TO_LLM_SERVER_API_KEY` | unset | Bearer token required by `POST /v1/responses`. |
| `CLAUDE_CODE_TO_LLM_SERVER_MOCK_MODE` | unset | Enables the test/mock runner. Do not use for real inference. |
| `CLAUDE_CODE_TO_LLM_SERVER_MOCK_RESPONSE` | `mock response` | Text emitted by the mock runner. |
| `CLAUDE_CODE_TO_LLM_BACKEND` | `claude-cli` | `claude-cli` or experimental `claude-oauth`. |
| `CLAUDE_CODE_TO_LLM_ACCEPT_DIRECT_API_CALL_RISK` | unset | Must equal `1` for `claude-oauth`. |
| `CLAUDE_CODE_TO_LLM_DIRECT_API_BASE_URL` | `https://api.anthropic.com` | Direct-mode base URL. |
| `CLAUDE_CODE_TO_LLM_CLAUDE_OAUTH_BASE_URL` | same | Legacy alias for the direct-mode base URL. |
| `CLAUDE_CODE_OAUTH_TOKEN` | unset | Direct-mode OAuth token; takes precedence over the credentials file. |
| `CLAUDE_CODE_TO_LLM_AUTH_PATH` | `~/.claude.json` | Claude Code session path or home hint. |
| `CLAUDE_CODE_TO_LLM_CREDENTIALS_PATH` | `~/.claude/.credentials.json` | Credentials copied into the isolated CLI home. |
| `CLAUDE_CODE_TO_LLM_SETTINGS_PATH` | unset | Optional settings copied into the isolated home. |
| `CLAUDE_CODE_TO_LLM_CLI_PATH` | `claude` | Claude Code executable. |
| `CLAUDE_CODE_TO_LLM_CONFIG_HOME` | temporary directory | Explicit caller-owned Claude home; not deleted. |
| `CLAUDE_CODE_TO_LLM_WORKSPACE` | temporary directory | Working directory for the CLI process. |
| `CLAUDE_CODE_TO_LLM_REASONING_EFFORT` | `low` | Default effort passed to the core runner. |

Equivalent CLI flags are available for host, port, model, backend, API key, search, auth paths, config home, workspace, and Claude executable. Run `claude-code-to-llm-server --help` for the exact list.

## Embed the Server

The package also exports `createServer()` and `startServer()`:

```js
import { startServer } from "@yadimon/claude-code-to-llm-server";

const server = await startServer({
  host: "127.0.0.1",
  port: 0,
  apiKey: process.env.LOCAL_LLM_API_KEY,
  models: ["claude-sonnet-4-6"]
});

console.log(server.url);
await server.close();
```

Port `0` selects a free local port. `startServer()` avoids browser-blocked dynamic ports.

## Docker

Build from the repository root:

```bash
docker build -f packages/claude-code-to-llm-server/Dockerfile -t claude-code-to-llm-server .
```

The image binds to `0.0.0.0` inside the container, so publish it on host loopback and set a bearer token:

```bash
docker run --rm \
  -p 127.0.0.1:3000:3000 \
  -e CLAUDE_CODE_TO_LLM_SERVER_API_KEY="replace-with-a-long-random-secret" \
  -v "$HOME/.claude.json:/root/.claude.json:ro" \
  -v "$HOME/.claude/.credentials.json:/root/.claude/.credentials.json:ro" \
  claude-code-to-llm-server
```

Never `COPY` credentials into a derived image. On Windows, use absolute host paths accepted by your Docker setup.

## Troubleshooting

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| `/healthz` works but `/v1/responses` returns 401 | Bearer token is configured but missing/wrong | Send the exact `Authorization: Bearer ...` header. |
| `Unsupported model` | Request model is outside the allowlist | Add it to `CLAUDE_CODE_TO_LLM_SERVER_MODELS` or request the default model. |
| `claude CLI not found` | Claude Code is absent from server `PATH` | Install/upgrade it or set `CLAUDE_CODE_TO_LLM_CLI_PATH`. |
| Session/credentials missing | Claude Code login files are unavailable to the process/container | Run `claude auth status`; fix the auth paths or read-only mounts. |
| Image URL cannot be downloaded | Upstream downloader rejected the host | Use a client-created data URL instead. |
| Browser reports a CORS error | The server does not add CORS headers | Call it from your backend/same origin or add a trusted reverse proxy with a narrow CORS policy. |
| Client calls `/v1/chat/completions` or sends tools | Client is using an unsupported OpenAI surface | Configure Responses API mode and use only the supported fields table. |
| SSE request returns HTTP 200 then `response.failed` | Failure occurred after stream headers were sent | Parse SSE error events and inspect the server log; HTTP status can no longer change. |
| Too many concurrent Claude processes | There is no built-in queue or rate limit | Limit concurrency in the caller or reverse proxy. |

## Development

```bash
npm run build --workspace @yadimon/claude-code-to-llm-server
npm run lint --workspace @yadimon/claude-code-to-llm-server
npm run typecheck --workspace @yadimon/claude-code-to-llm-server
npm test --workspace @yadimon/claude-code-to-llm-server
```

## License

MIT
