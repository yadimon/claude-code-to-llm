import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createClaudeCodeExitError,
  runPrompt,
  normalizeRunOptions,
  normalizeSpawnError
} from "../src/index.js";

// Windows .cmd shims re-expand args via `%*`, which surfaces an empty
// argument as the literal 2-char string `""`. The real claude CLI is a
// `.exe` (no shim, no re-expansion), so this only affects fake-claude
// fixtures — treat both forms as equivalent in assertions.
function normalizeEmpty(arg: string | undefined): string {
  return arg === "\"\"" ? "" : (arg ?? "");
}

function assertMinimalArgs(args: string[], { webSearch }: { webSearch: boolean }): void {
  const toolsIdx = args.indexOf("--tools");
  assert.notEqual(toolsIdx, -1, "expected --tools flag");
  assert.equal(normalizeEmpty(args[toolsIdx + 1]), webSearch ? "WebSearch" : "");
  assert.ok(args.includes("--disable-slash-commands"));
  const sysIdx = args.indexOf("--system-prompt");
  assert.notEqual(sysIdx, -1, "expected --system-prompt flag");
  assert.equal(normalizeEmpty(args[sysIdx + 1]), "");
  assert.ok(!args.includes("--allowed-tools"));
  assert.ok(!args.includes("--disallowed-tools"));
  assert.ok(!args.includes("--exclude-dynamic-system-prompt-sections"));
}

function writeAuthBundle(rootDir: string): { sessionPath: string; credentialsPath: string } {
  const sessionPath = path.join(rootDir, ".claude.json");
  const claudeDir = path.join(rootDir, ".claude");
  const credentialsPath = path.join(claudeDir, ".credentials.json");
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(sessionPath, "{\"oauthAccount\":{\"email\":\"test@example.com\"}}\n", "utf8");
  fs.writeFileSync(credentialsPath, "{\"claudeAiOauth\":{\"accessToken\":\"x\"}}\n", "utf8");
  return { sessionPath, credentialsPath };
}

test("runPrompt rejects empty prompts before spawning Claude Code", async () => {
  await assert.rejects(runPrompt("   "), /Prompt must not be empty/);
});

test("normalizeRunOptions rejects invalid CLI-facing values", () => {
  assert.throws(
    () => normalizeRunOptions({ reasoningEffort: 'high"; bad' }),
    /Invalid reasoning effort/
  );
  assert.throws(
    () => normalizeRunOptions({ model: "--bad-model" }),
    /Invalid model/
  );
});

test("normalizeRunOptions defaults webSearch to false and accepts true", () => {
  assert.equal(normalizeRunOptions({}).webSearch, false);
  assert.equal(normalizeRunOptions({ webSearch: true }).webSearch, true);
  assert.equal(normalizeRunOptions({ webSearch: false }).webSearch, false);
});

test("normalizeRunOptions rejects invalid timeout values", () => {
  assert.throws(() => normalizeRunOptions({ timeout: -1 }), /Invalid timeout/);
  assert.throws(() => normalizeRunOptions({ timeout: Number.NaN }), /Invalid timeout/);
  assert.throws(() => normalizeRunOptions({ timeout: 1500.9 }), /Invalid timeout/);
});

test("normalizeRunOptions rejects invalid maxTokens values", () => {
  assert.throws(() => normalizeRunOptions({ maxTokens: -1 }), /Invalid maxTokens/);
  assert.throws(() => normalizeRunOptions({ maxTokens: 1.5 }), /Invalid maxTokens/);
});

test("normalizeRunOptions resolves cliPath from explicit options and environment", () => {
  const previousCliPath = process.env.CLAUDE_CODE_TO_LLM_CLI_PATH;
  process.env.CLAUDE_CODE_TO_LLM_CLI_PATH = "claude-from-env";

  try {
    assert.equal(normalizeRunOptions({}).cliPath, "claude-from-env");
    assert.equal(normalizeRunOptions({ cliPath: "custom-claude" }).cliPath, "custom-claude");
  } finally {
    if (previousCliPath == null) {
      delete process.env.CLAUDE_CODE_TO_LLM_CLI_PATH;
    } else {
      process.env.CLAUDE_CODE_TO_LLM_CLI_PATH = previousCliPath;
    }
  }
});

test("normalizeSpawnError provides targeted permission errors", () => {
  const error = normalizeSpawnError({ code: "EACCES" }, "claude");

  assert.match(error.message, /not executable/);
});

test("createClaudeCodeExitError prefers stderr or parsed result messages over generic exit codes", () => {
  assert.equal(createClaudeCodeExitError(0, null, ""), undefined);
  assert.match(
    createClaudeCodeExitError(null, "SIGTERM", "")?.message || "",
    /signal SIGTERM/
  );
  assert.match(createClaudeCodeExitError(1, null, "")?.message || "", /code 1/);
  assert.match(
    createClaudeCodeExitError(1, null, "", "Invalid authentication credentials")?.message || "",
    /Invalid authentication credentials/
  );
});

test("runPrompt spawns claude in minimal mode and forwards web search opt-in", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-code-to-llm-websearch-"));
  const { sessionPath, credentialsPath } = writeAuthBundle(tempDir);
  const capturePath = path.join(tempDir, "capture.json");
  const fixturePath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "./fixtures/fake-claude.mjs"
  );
  const cliPath =
    process.platform === "win32" ? path.join(tempDir, "fake-claude.cmd") : fixturePath;
  if (process.platform === "win32") {
    fs.writeFileSync(cliPath, `@echo off\r\n"${process.execPath}" "${fixturePath}" %*\r\n`, "utf8");
  }

  const previousCapture = process.env.FAKE_CLAUDE_CAPTURE_FILE;
  process.env.FAKE_CLAUDE_CAPTURE_FILE = capturePath;

  try {
    await runPrompt("Hello", {
      authPath: sessionPath,
      credentialsPath,
      cliPath,
      timeout: 5000,
      webSearch: true
    });
    const enabledCapture = JSON.parse(fs.readFileSync(capturePath, "utf8")) as {
      args: string[];
      stdin: string;
    };
    assertMinimalArgs(enabledCapture.args, { webSearch: true });
    assert.ok(!enabledCapture.args.includes("Hello"));
    assert.equal(enabledCapture.stdin, "Hello");

    await runPrompt("Hello", {
      authPath: sessionPath,
      credentialsPath,
      cliPath,
      timeout: 5000
    });
    const disabledCapture = JSON.parse(fs.readFileSync(capturePath, "utf8")) as {
      args: string[];
      stdin: string;
    };
    assertMinimalArgs(disabledCapture.args, { webSearch: false });
    assert.ok(!disabledCapture.args.includes("Hello"));
    assert.equal(disabledCapture.stdin, "Hello");

    await runPrompt("Hello", {
      authPath: sessionPath,
      credentialsPath,
      cliPath,
      timeout: 5000,
      // Single token avoids Windows cmd-shim arg-splitting in the fixture;
      // real claude is a .exe so production isn't affected.
      systemPrompt: "minimal"
    });
    const customCapture = JSON.parse(fs.readFileSync(capturePath, "utf8")) as {
      args: string[];
      stdin: string;
    };
    const customIdx = customCapture.args.indexOf("--system-prompt");
    assert.notEqual(customIdx, -1);
    assert.equal(customCapture.args[customIdx + 1], "minimal");
    assert.ok(!customCapture.args.includes("--append-system-prompt"));
  } finally {
    if (previousCapture == null) {
      delete process.env.FAKE_CLAUDE_CAPTURE_FILE;
    } else {
      process.env.FAKE_CLAUDE_CAPTURE_FILE = previousCapture;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("runPrompt fails when the Claude Code process exits due to a signal", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-code-to-llm-signal-"));
  const { sessionPath, credentialsPath } = writeAuthBundle(tempDir);
  const fixturePath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "./fixtures/fake-claude.mjs"
  );
  const cliPath =
    process.platform === "win32" ? path.join(tempDir, "fake-claude.cmd") : fixturePath;
  if (process.platform === "win32") {
    fs.writeFileSync(cliPath, `@echo off\r\n"${process.execPath}" "${fixturePath}" %*\r\n`, "utf8");
  }

  const previousSignal = process.env.FAKE_CLAUDE_TERMINATE_SIGNAL;
  process.env.FAKE_CLAUDE_TERMINATE_SIGNAL = "SIGTERM";

  try {
    await assert.rejects(
      runPrompt("Hello", {
        authPath: sessionPath,
        credentialsPath,
        cliPath,
        timeout: 5000
      }),
      /signal SIGTERM|code 1/
    );
  } finally {
    if (previousSignal == null) {
      delete process.env.FAKE_CLAUDE_TERMINATE_SIGNAL;
    } else {
      process.env.FAKE_CLAUDE_TERMINATE_SIGNAL = previousSignal;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
