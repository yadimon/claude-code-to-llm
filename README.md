# claude-code-to-llm

Monorepo for two npm packages built around the Claude Code CLI:

- `@yadimon/claude-code-to-llm`: raw prompt SDK and CLI around `claude -p`
- `@yadimon/claude-code-to-llm-server`: OpenAI-compatible `/v1/responses` server on top of the core package

The npm-facing docs live in:

- [`packages/claude-code-to-llm/README.md`](./packages/claude-code-to-llm/README.md)
- [`packages/claude-code-to-llm-server/README.md`](./packages/claude-code-to-llm-server/README.md)

## Requirements

- Node.js `>=20`
- installed `claude` CLI in `PATH`
- valid Claude Code login on the machine

By default the wrapper copies Claude Code auth from:

- `~/.claude.json`
- `~/.claude/.credentials.json`

Claude Code’s current docs explicitly describe `~/.claude/settings.json` and `~/.claude.json` as user-level config locations, and on this Windows machine a working Claude Pro login also uses `~/.claude/.credentials.json`. The package copies that auth bundle into a temporary home before each run so it can use your existing Claude Code subscription without mutating your real profile.

## Workspace Development

```bash
npm install
npm run lint
npm run typecheck
npm test
npm run build
```

Useful local commands:

```bash
npm run smoke:core
npm run smoke:server
npm run start:server
npm run start:server:mock
```

## Package Layout

```text
packages/claude-code-to-llm
  core SDK, CLI, parser, and Claude Code runner

packages/claude-code-to-llm-server
  HTTP adapter exposing /healthz, /v1/models, and /v1/responses

scripts
  workspace test, pack, and release helpers
```

## Release Flow

This repository publishes two independent npm packages:

- `@yadimon/claude-code-to-llm`
- `@yadimon/claude-code-to-llm-server`

They are versioned separately and released with package-specific tags:

- `claude-code-to-llm-v<version>`
- `claude-code-to-llm-server-v<version>`

Pre-release verification:

```bash
npm run check
npm run release:check
```

Release commands:

```bash
npm run release:core:patch
npm run release:core:minor
npm run release:core:major

npm run release:server:patch
npm run release:server:minor
npm run release:server:major
```

The detailed maintainer workflow lives in `RELEASING.md`.

## Docker

Build the server image from the repository root:

```bash
docker build -f packages/claude-code-to-llm-server/Dockerfile .
```

Run the Docker verification path with:

```bash
npm run test:docker
```
