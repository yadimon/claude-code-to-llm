# @yadimon/claude-code-to-llm

Run one-shot text and vision prompts through your local Claude Code login with a small Node.js SDK or command-line interface.

The default runner starts `claude --print` in an isolated, minimal environment. It keeps subscription/OAuth authentication, but removes Claude Code's coding-agent context: no file or shell tools, no project instructions, no plugins, no MCP servers, no memory, and no persisted session. This makes it useful for application-owned classification, extraction, translation, evaluation, and image-analysis jobs.

> [!IMPORTANT]
> This is an independent wrapper, not an official Anthropic SDK. If you need agent tools or durable sessions, use the [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-typescript). If you need a supported production API with API-key billing, use Anthropic's official SDK. To expose this runner over HTTP, see [`@yadimon/claude-code-to-llm-server`](https://github.com/yadimon/claude-code-to-llm/tree/main/packages/claude-code-to-llm-server).

## Install

```bash
npm install @yadimon/claude-code-to-llm
```

Requirements:

- Node.js 20 or newer
- Claude Code CLI 2.1.179 or newer in `PATH`, or an explicit `cliPath`
- a working Claude Code login on the same machine

Check the prerequisites:

```bash
claude --version
claude auth status
```

## Quick Start

```js
import { runPrompt } from "@yadimon/claude-code-to-llm";

const response = await runPrompt("Translate to German: Good morning", {
  model: "claude-sonnet-4-6",
  maxTokens: 80
});

console.log(response.content);
console.log(response.usage.totalTokens);
```

`runPrompt()` resolves to:

```ts
type CoreResponse = {
  id: string;
  model: string;
  prompt: string;
  createdAt: number;
  content: string;
  usage: {
    inputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
    outputTokens: number;
    totalTokens: number;
    webSearchRequests: number;
    webFetchRequests: number;
  };
  raw: { stderr: string; events: unknown[] };
};
```

For structured work, tell Claude to return JSON and validate it in your application. The package returns text; it does not enforce a JSON Schema for you.

```js
const response = await runPrompt("Password reset email", {
  systemPrompt: 'Classify the text. Return only JSON: {"label":"account|billing|other"}.'
});

const result = JSON.parse(response.content);
```

## Vision

`images` accepts local files, HTTPS URLs, and base64 data. Images are passed as real multimodal content blocks while Claude Code tools remain disabled.

### Local file

```js
import { runPrompt } from "@yadimon/claude-code-to-llm";

const response = await runPrompt("Describe this UI and point out the primary action.", {
  images: [{ type: "file", path: "./screenshot.png" }]
});

console.log(response.content);
```

Relative file paths resolve against `cwd` when supplied, otherwise against the caller's current working directory.

### URL and base64

```js
import { readFile } from "node:fs/promises";
import { runPrompt } from "@yadimon/claude-code-to-llm";

const response = await runPrompt("Compare these images.", {
  images: [
    { type: "url", url: "https://example.com/reference.webp" },
    {
      type: "base64",
      mediaType: "image/jpeg",
      data: await readFile("./candidate.jpg", "base64")
    }
  ]
});
```

Supported formats are JPEG, PNG, GIF, and WebP. The package validates file signatures and declared media types before invoking Claude.

| Limit | Value |
| --- | ---: |
| Images per request | 100 |
| Encoded base64 per image | 10 MiB |
| Encoded base64 across embedded images | 20 MiB |
| URL protocol | HTTPS only |

URL download size and reachability are controlled upstream. If a public host is rejected or flaky, download the file yourself and pass a local file or base64 data for a deterministic transport path.

## Streaming

```js
import { streamPrompt } from "@yadimon/claude-code-to-llm";

for await (const event of streamPrompt("Give me three release-note bullets.")) {
  if (event.type === "response.output_text.delta") {
    process.stdout.write(event.delta);
  }

  if (event.type === "response.completed") {
    console.error("\nTokens:", event.response.usage.totalTokens);
  }
}
```

The stream also contains `response.started`, `response.raw_event`, and `response.failed` events. Raw events expose Claude Code protocol details and may change with Claude Code; prefer the normalized events for application logic.

## CLI

Run without a global install:

```bash
npx @yadimon/claude-code-to-llm --prompt "Hello"
npx @yadimon/claude-code-to-llm --input-file ./prompt.txt --json
npx @yadimon/claude-code-to-llm --prompt "Describe this" --image ./screenshot.png
npx @yadimon/claude-code-to-llm --prompt "Compare these" --image ./one.png --image https://example.com/two.jpg
```

Pipe a prompt and emit newline-delimited stream events:

```bash
node ./make-prompt.mjs | npx @yadimon/claude-code-to-llm --stream --json
```

Options:

```text
--prompt <text>
--input-file <path>
--image <path|url|data-url> (repeatable)
--stream
--json
--verbose
--model <name>
--reasoning-effort <low|medium|high|max>
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

## SDK Options

```ts
type RunOptions = {
  model?: string;                 // default: claude-sonnet-4-6
  reasoningEffort?: string;       // default: low
  maxTokens?: number;
  timeout?: number;               // milliseconds; default: 5 minutes
  systemPrompt?: string;
  webSearch?: boolean;            // opt in to the WebSearch tool
  images?: ImageInput[];
  cwd?: string;
  cliPath?: string;
  authPath?: string;
  credentialsPath?: string;
  settingsPath?: string;
  configHome?: string;
  responseId?: string;
};
```

`createRunner(baseOptions)` is useful when many calls share the same model, timeout, auth paths, or system prompt.

## Minimal Mode and Isolation

Minimal mode is always on for `runPrompt()` and `streamPrompt()`:

- `--tools ""` removes built-in tool schemas. `webSearch: true` enables only `WebSearch` for that call.
- `--disable-slash-commands` excludes slash-command metadata.
- `--system-prompt ""` replaces Claude Code's agent preset. `systemPrompt` supplies your own replacement.
- `--no-session-persistence`, safe mode, and no Chrome keep calls isolated.
- a strict empty MCP configuration ignores user and project MCP servers.
- environment flags disable auto-memory, history, checkpoints, bundled skills, marketplace auto-install, updater, telemetry, and error reporting.

The package does not use Claude Code's `--bare` flag because current Claude Code versions make bare mode skip OAuth and keychain reads. It instead creates a temporary home that contains an empty session file, an empty MCP config, and a copy of the local credentials file. It does not copy user settings unless `settingsPath` is explicit.

One release benchmark with Claude Code 2.1.179 and `claude-sonnet-4-6` measured a 151-token input floor for a tiny prompt. This is a snapshot, not a guarantee: Claude Code and model routing can change. Run the repository's `npm run smoke:tokens` before relying on a budget.

## Authentication and Security

Default files:

- `~/.claude.json`
- `~/.claude/.credentials.json`

Both must exist. Claude Code itself manages these files through login/logout. The wrapper reads them only on the local machine, copies the credential into its isolated home, and normally removes package-owned temporary directories after the call.

The spawned CLI inherits the caller's environment. Claude Code's own authentication precedence still applies: for example, an approved `ANTHROPIC_API_KEY` can take precedence over subscription OAuth. Remove unintended provider credentials from the process environment and check `claude auth status` when the billing/auth route matters.

If you pass `configHome` or `cwd`, those directories are caller-owned and are not deleted. Keep a persistent `configHome` private because it contains a credentials copy. Never commit `.claude-code-to-llm/`, credentials, session files, or tokens.

Custom user settings, hooks, and plugins are intentionally excluded. Supplying `settingsPath` expands the trust boundary and can change behavior; use it only when required.

See [Claude Code authentication](https://code.claude.com/docs/en/authentication) for Anthropic's current login methods, credential storage, and precedence rules.

## Environment Variables

The core SDK primarily uses `RunOptions`, and its CLI uses the matching flags. These are the environment variables the core package reads directly:

| Variable | Default | Purpose |
| --- | --- | --- |
| `CLAUDE_CODE_TO_LLM_CLI_PATH` | `claude` | Default CLI-backed runner executable. |
| `CLAUDE_CODE_TO_LLM_LOCAL_HOME` | `.claude-code-to-llm/` | Destination used only by the auth-copy helper. |
| `CLAUDE_CODE_TO_LLM_ACCEPT_DIRECT_API_CALL_RISK` | unset | Direct-mode CLI acknowledgement; must equal `1`. |
| `CLAUDE_CODE_TO_LLM_DIRECT_API_BASE_URL` | `https://api.anthropic.com` | Experimental direct-mode base URL. |
| `CLAUDE_CODE_TO_LLM_CREDENTIALS_PATH` | `~/.claude/.credentials.json` | Direct mode's credentials-file override. |
| `CLAUDE_CODE_OAUTH_TOKEN` | unset | Direct-mode token; takes precedence over the credentials file. |

Use `authPath`, `credentialsPath`, `settingsPath`, `configHome`, `cwd`, and `reasoningEffort` in the SDK, or their documented CLI flags, for CLI-backed path and runtime overrides. The server package additionally maps its configuration environment variables into those options.

## Experimental Direct API Mode

Direct mode bypasses the `claude` child process and calls an Anthropic Messages-compatible endpoint with Claude Code OAuth credentials. It is off by default and is not the normal `ANTHROPIC_API_KEY` billing path. The CLI requires explicit risk acknowledgement; in the SDK, choosing a separately named direct-mode function is the opt-in.

```bash
npx @yadimon/claude-code-to-llm \
  --direct-api-call \
  --accept-direct-api-call-risk \
  --max-tokens 80 \
  --prompt "Translate to German: Good morning"
```

PowerShell:

```powershell
$env:CLAUDE_CODE_TO_LLM_ACCEPT_DIRECT_API_CALL_RISK = "1"
npx @yadimon/claude-code-to-llm --direct-api-call --prompt "Translate to German: Good morning"
```

The SDK exports `runDirectApiPrompt`, `streamDirectApiPrompt`, and `createDirectApiRunner` for the same opt-in transport. Direct mode reads auth in this order:

1. `CLAUDE_CODE_OAUTH_TOKEN`
2. `CLAUDE_CODE_TO_LLM_CREDENTIALS_PATH`
3. `~/.claude/.credentials.json`

Direct mode sends a short Claude-Code transport identity, but not the coding-agent prompt, project context, tools, slash commands, or memory. Anthropic may change, restrict, rate-limit, or block this transport. Do not expose it to untrusted users or networks, and review [Anthropic's Consumer Terms](https://www.anthropic.com/legal/consumer-terms) for your use case.

## Limitations

- One call is one isolated turn. There is no conversation/session continuation API.
- No general tool calling, function calling, file access, shell access, or coding-agent loop.
- JSON and other structured outputs are prompt conventions; validate them yourself.
- Model availability and aliases depend on Claude Code and the authenticated account.
- The CLI-backed runner currently requires file-based `~/.claude.json` and `.claude/.credentials.json`; a credential available only through a platform keychain is not enough for its isolated-home copy.
- The default backend starts a Claude Code process per call, so high-volume tiny requests have process overhead.
- `webSearch` is an explicit exception to tool-free mode and is not supported by direct mode.
- HTTPS image fetches depend on Anthropic's downloader and its network policy.

## Troubleshooting

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| `claude CLI not found` | CLI is not in `PATH` | Install/upgrade Claude Code or set `CLAUDE_CODE_TO_LLM_CLI_PATH` / `cliPath` to the executable. |
| Upgrade hint before a request | Claude Code is older than 2.1.179 | Run `npm i -g @anthropic-ai/claude-code@latest`, then check `claude --version`. |
| `Claude Code session auth not found` | `~/.claude.json` is missing or a custom path is wrong | Run `claude` to complete login, or pass the correct `authPath`. |
| `Claude Code credentials not found` / login expired | Credentials are missing or stale | Run `claude auth status`, then log in again if needed. |
| Image URL cannot be downloaded | Upstream downloader rejected the host or response | Pass a local file or base64 image; do not retry an unreliable host indefinitely. |
| Images disappear only with custom settings | A copied hook/plugin changes multimodal input | Remove `settingsPath` and use the default isolated home. |
| Windows wrapper rejects newline arguments | A `.cmd` shim cannot preserve the arguments safely | Point `cliPath` at the real Claude executable rather than the command shim. |
| Request times out | Model, network, or subscription queue exceeded the default | Increase `timeout` in milliseconds and keep application-level retry limits. |

Use `--verbose` on the CLI to print an error stack. Raw Claude events are also retained in `response.raw.events` for local diagnosis; do not log them if prompts or model outputs are sensitive.

## Development

```bash
npm run build --workspace @yadimon/claude-code-to-llm
npm run lint --workspace @yadimon/claude-code-to-llm
npm run typecheck --workspace @yadimon/claude-code-to-llm
npm test --workspace @yadimon/claude-code-to-llm
```

## License

MIT
