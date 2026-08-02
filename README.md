# claude-code-to-llm

Use a logged-in Claude Code CLI as a small text-and-vision provider for local scripts, Node.js applications, and Responses-compatible clients.

This repository deliberately removes the agent harness from one-shot calls: no file or shell tools, no project instructions, no plugins, no MCP servers, no conversation persistence, and no Claude Code system prompt unless you provide your own. The result is a narrow interface for classification, extraction, translation, evaluation, and screenshot analysis—not another coding agent.

> [!IMPORTANT]
> This is an independent project, not an official Anthropic SDK. It runs on the machine that owns the Claude Code login. For a supported production API, use the official Anthropic API and SDK; for agents that read, edit, run commands, or manage sessions, use the [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-typescript).

## Choose a Package

| Package | Use it when | Interface |
| --- | --- | --- |
| [`@yadimon/claude-code-to-llm`](./packages/claude-code-to-llm/README.md) | Your Node.js process or shell can run the local `claude` executable | `runPrompt`, `streamPrompt`, and `claude-code-to-llm` |
| [`@yadimon/claude-code-to-llm-server`](./packages/claude-code-to-llm-server/README.md) | Existing software already speaks the OpenAI Responses API, or several local processes need one endpoint | `POST /v1/responses`, SSE, models, and health endpoints |

The server is a thin HTTP adapter over the core package. It implements a documented subset of the Responses API, not the full OpenAI platform.

## Quick Start

Requirements for the default backend:

- Node.js 20 or newer
- Claude Code CLI 2.1.179 or newer in `PATH`
- a working Claude Code login (`claude auth status`)

### Node.js SDK

```bash
npm install @yadimon/claude-code-to-llm
```

```js
import { runPrompt } from "@yadimon/claude-code-to-llm";

const response = await runPrompt("Classify: Password reset email", {
  model: "claude-sonnet-4-6",
  systemPrompt: 'Return one label: "account", "billing", or "other".',
  maxTokens: 20
});

console.log(response.content);
console.log(response.usage);
```

Images are model inputs, not files opened by a tool:

```js
const response = await runPrompt("Describe this screenshot.", {
  images: [{ type: "file", path: "./screenshot.png" }]
});
```

### Responses-compatible server

```bash
npx @yadimon/claude-code-to-llm-server
```

In another terminal:

```js
const response = await fetch("http://127.0.0.1:3000/v1/responses", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "claude-sonnet-4-6",
    input: "Say hello in one short sentence."
  })
});

console.log((await response.json()).output_text);
```

See the package READMEs for streaming, image URLs and data URLs, supported request fields, authentication, and troubleshooting.

## How a Default Call Works

```text
your code / CLI / HTTP client
          |
          v
@yadimon/claude-code-to-llm
  - creates an isolated temporary home and workspace
  - copies only the local credential needed for the run
  - disables tools, plugins, MCP, memory, history, and telemetry
          |
          v
claude --print --output-format stream-json
          |
          v
text, usage, and optional streaming events
```

The wrapper intentionally does not use Claude Code's `--bare` mode: current Claude Code versions make `--bare` skip OAuth and keychain reads. Instead, the package constructs its own minimal home so a normal Claude Code login still works while user and project customizations stay out of the request.

## What It Is Good At

- repeated structured classification or extraction where your application validates the returned JSON
- local batch jobs that should use a Claude Code login rather than carry an API key
- vision jobs with local files, HTTPS images, or base64/data URLs
- streaming text into an existing program
- adapting a narrow Responses client to a local Claude process

It is not designed for tool calling, file editing, autonomous coding, durable conversations, multi-user hosting, or general OpenAI API emulation.

## Authentication and Trust Boundary

By default the packages expect Claude Code's local auth files at:

- `~/.claude.json`
- `~/.claude/.credentials.json`

Each CLI-backed call creates a temporary Claude home, copies the credentials file, writes empty session and MCP configuration, and removes package-owned temporary directories when the call finishes. User settings are not copied unless `CLAUDE_CODE_TO_LLM_SETTINGS_PATH` or `settingsPath` is explicitly set.

Treat the process as credential-bearing software:

- run it only on machines and accounts you control;
- never commit or copy the auth bundle into an image;
- keep the server on loopback unless you add its bearer token plus a trusted TLS/reverse-proxy boundary;
- do not expose the experimental direct-OAuth backend to untrusted callers;
- review the terms that apply to your Claude account and intended automation.

Claude Code's current authentication and credential locations are documented in [Claude Code authentication](https://code.claude.com/docs/en/authentication). Anthropic's programmatic CLI behavior is documented in [Run Claude Code programmatically](https://code.claude.com/docs/en/headless).

## Repository Development

```bash
npm install
npm run lint
npm run typecheck
npm test
npm run build
```

Useful local checks:

```bash
npm run smoke:core
npm run smoke:server
npm run smoke:vision
npm run smoke:tokens
```

The vision smokes use the local Claude login and make real model calls. Unit and mock-server tests do not.

## Package Layout

```text
packages/claude-code-to-llm
  core SDK, CLI, image normalization, and Claude Code runner

packages/claude-code-to-llm-server
  thin HTTP adapter for /healthz, /v1/models, and /v1/responses

scripts
  workspace test, pack, smoke, and release helpers
```

## Release Flow

The two packages are versioned and released independently. Before a release:

```bash
npm run check
npm run release:check
```

Release helpers create package-specific tags:

```bash
npm run release:core:patch
npm run release:server:patch
```

Normal releases use GitHub Actions Trusted Publishing. See [`RELEASING.md`](./RELEASING.md) for the complete maintainer workflow.

## Docker

The Docker image contains the server and Claude Code CLI; credentials must be mounted at runtime, never baked into the image.

```bash
docker build -f packages/claude-code-to-llm-server/Dockerfile .
npm run test:docker
```

## License

MIT
