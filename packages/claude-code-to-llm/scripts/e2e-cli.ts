import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

const packageRoot = process.cwd();
const fakeClaudePath =
  process.platform === "win32"
    ? path.join(packageRoot, "test", "fixtures", "fake-claude.cmd")
    : path.join(packageRoot, "test", "fixtures", "fake-claude.mjs");

if (process.platform !== "win32") {
  fs.chmodSync(fakeClaudePath, 0o755);
}

function makeTempFile(name: string, content: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-code-to-llm-e2e-"));
  const file = path.join(dir, name);
  fs.writeFileSync(file, content, "utf8");
  return { dir, file };
}

function makeTempAuthBundle() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-code-auth-e2e-"));
  const sessionPath = path.join(dir, ".claude.json");
  const claudeDir = path.join(dir, ".claude");
  const credentialsPath = path.join(claudeDir, ".credentials.json");
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(sessionPath, "{\"oauthAccount\":{\"email\":\"test@example.com\"}}\n", "utf8");
  fs.writeFileSync(credentialsPath, "{\"claudeAiOauth\":{\"accessToken\":\"x\"}}\n", "utf8");
  return { dir, sessionPath, credentialsPath };
}

function runCli(args: string[], options: { env?: NodeJS.ProcessEnv; input?: string } = {}) {
  return spawnSync(process.execPath, ["--import", "tsx/esm", "./src/cli.ts", ...args], {
    cwd: packageRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      ...options.env
    },
    input: options.input
  });
}

{
  const auth = makeTempAuthBundle();
  const { dir, file } = makeTempFile("prompt.txt", "Hello-from-file");

  try {
    const result = runCli(["--input-file", file, "--json", "--cli", fakeClaudePath], {
      env: {
        CLAUDE_CODE_TO_LLM_AUTH_PATH: auth.sessionPath,
        CLAUDE_CODE_TO_LLM_CREDENTIALS_PATH: auth.credentialsPath
      }
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.prompt, "Hello-from-file");
    assert.equal(parsed.content, "FAKE:Hello-from-file");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(auth.dir, { recursive: true, force: true });
  }
}

{
  const auth = makeTempAuthBundle();
  const result = runCli(["--stream", "--json", "--cli", fakeClaudePath], {
    env: {
      CLAUDE_CODE_TO_LLM_AUTH_PATH: auth.sessionPath,
      CLAUDE_CODE_TO_LLM_CREDENTIALS_PATH: auth.credentialsPath
    },
    input: "Hello-from-stdin"
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const events = result.stdout
    .trim()
    .split(/\r?\n/)
    .map(line => JSON.parse(line));

  assert.equal(events[0].type, "response.started");
  assert.equal(events.some(event => event.type === "response.output_text.delta"), true);
  assert.equal(events.at(-1).type, "response.completed");

  fs.rmSync(auth.dir, { recursive: true, force: true });
}

console.log("claude-code-to-llm CLI e2e passed");
