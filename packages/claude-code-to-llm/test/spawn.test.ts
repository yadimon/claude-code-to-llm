import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  explicitCliCandidates,
  preferWindowsExecutable,
  quoteCmdArg,
  resolveSpawnForPlatform
} from "../src/index.js";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "claude-code-to-llm-spawn-"));
}

test("resolveSpawnForPlatform uses cmd wrapper on Windows for bare commands", () => {
  const resolved = resolveSpawnForPlatform("codex", ["exec", "--model", "gpt 5"], "win32");

  assert.equal(resolved.command, "cmd.exe");
  assert.deepEqual(resolved.args, ["/d", "/s", "/c", "\"codex exec --model \"gpt 5\"\""]);
  assert.equal(resolved.windowsVerbatimArguments, true);
});

test("resolveSpawnForPlatform uses cmd wrapper on Windows for .cmd shims", () => {
  const resolved = resolveSpawnForPlatform(
    "C:\\Program Files\\Codex\\codex.cmd",
    ["exec", "--json"],
    "win32"
  );

  assert.equal(resolved.command, "cmd.exe");
  assert.deepEqual(resolved.args, [
    "/d",
    "/s",
    "/c",
    "\"\"C:\\Program Files\\Codex\\codex.cmd\" exec --json\""
  ]);
  assert.equal(resolved.windowsVerbatimArguments, true);
});

test("resolveSpawnForPlatform spawns .exe paths directly on Windows", () => {
  const resolved = resolveSpawnForPlatform(
    "C:\\Users\\me\\.local\\bin\\claude.exe",
    ["--system-prompt", "line one\nline two"],
    "win32"
  );

  assert.equal(resolved.command, "C:\\Users\\me\\.local\\bin\\claude.exe");
  assert.deepEqual(resolved.args, ["--system-prompt", "line one\nline two"]);
  assert.equal(resolved.windowsVerbatimArguments, undefined);
});

test("resolveSpawnForPlatform executes directly on non-Windows platforms", () => {
  const resolved = resolveSpawnForPlatform("/usr/local/bin/codex", ["exec", "--json"], "linux");

  assert.equal(resolved.command, "/usr/local/bin/codex");
  assert.deepEqual(resolved.args, ["exec", "--json"]);
  assert.equal(resolved.windowsVerbatimArguments, undefined);
});

test("resolveSpawnForPlatform rejects newline args when the cmd wrapper is required", () => {
  assert.throws(
    () => resolveSpawnForPlatform("claude", ["--system-prompt", "line one\nline two"], "win32"),
    /newline.*CLAUDE_CODE_TO_LLM_CLI_PATH/s
  );
});

test("resolveSpawnForPlatform rejects carriage-return args when the cmd wrapper is required", () => {
  assert.throws(
    () => resolveSpawnForPlatform("C:\\x\\claude.cmd", ["--system-prompt", "a\rb"], "win32"),
    /newline.*CLAUDE_CODE_TO_LLM_CLI_PATH/s
  );
});

test("resolveSpawnForPlatform passes newline args through on non-Windows platforms", () => {
  const resolved = resolveSpawnForPlatform(
    "/usr/local/bin/claude",
    ["--system-prompt", "line one\nline two"],
    "linux"
  );

  assert.deepEqual(resolved.args, ["--system-prompt", "line one\nline two"]);
});

test("quoteCmdArg quotes whitespace, quotes, empty strings, and cmd metacharacters", () => {
  assert.equal(quoteCmdArg("plain"), "plain");
  assert.equal(quoteCmdArg(""), "\"\"");
  assert.equal(quoteCmdArg("two words"), "\"two words\"");
  assert.equal(quoteCmdArg("he said \"hi\""), "\"he said \"\"hi\"\"\"");
  assert.equal(quoteCmdArg("a&b"), "\"a&b\"");
  assert.equal(quoteCmdArg("a|b"), "\"a|b\"");
  assert.equal(quoteCmdArg("a<b>c"), "\"a<b>c\"");
  assert.equal(quoteCmdArg("a^b"), "\"a^b\"");
});

test("preferWindowsExecutable upgrades an explicit extension-less path to a sibling .exe", () => {
  const dir = makeTempDir();
  const exePath = path.join(dir, "claude.exe");
  fs.writeFileSync(exePath, "");

  assert.equal(preferWindowsExecutable(path.join(dir, "claude"), "win32"), exePath);
});

test("preferWindowsExecutable keeps an explicit extension-less path without a sibling .exe", () => {
  const dir = makeTempDir();
  const cliPath = path.join(dir, "claude");

  assert.equal(preferWindowsExecutable(cliPath, "win32"), cliPath);
});

test("preferWindowsExecutable resolves bare commands to a .exe found on PATH", () => {
  const emptyDir = makeTempDir();
  const binDir = makeTempDir();
  const exePath = path.join(binDir, "claude.exe");
  fs.writeFileSync(exePath, "");

  const resolved = preferWindowsExecutable("claude", "win32", {
    PATH: [emptyDir, binDir].join(path.delimiter)
  });

  assert.equal(resolved, exePath);
});

test("preferWindowsExecutable keeps bare commands without a .exe on PATH", () => {
  const emptyDir = makeTempDir();

  assert.equal(preferWindowsExecutable("claude", "win32", { PATH: emptyDir }), "claude");
});

test("preferWindowsExecutable respects explicit extensions", () => {
  assert.equal(preferWindowsExecutable("C:\\x\\claude.cmd", "win32", { PATH: "" }), "C:\\x\\claude.cmd");
});

test("preferWindowsExecutable is a no-op on non-Windows platforms", () => {
  assert.equal(preferWindowsExecutable("claude", "linux", { PATH: "/usr/bin" }), "claude");
});

test("explicitCliCandidates probes .exe before .cmd and .bat on Windows", () => {
  assert.deepEqual(explicitCliCandidates("C:\\x\\claude", "win32"), [
    "C:\\x\\claude.exe",
    "C:\\x\\claude.cmd",
    "C:\\x\\claude.bat",
    "C:\\x\\claude"
  ]);
  assert.deepEqual(explicitCliCandidates("C:\\x\\claude.exe", "win32"), ["C:\\x\\claude.exe"]);
  assert.deepEqual(explicitCliCandidates("/usr/bin/claude", "linux"), ["/usr/bin/claude"]);
});

test(
  "cmd wrapper round-trips spaces, quotes, and empty args through a real .cmd shim",
  { skip: process.platform !== "win32" },
  () => {
    const dir = path.join(makeTempDir(), "dir with space");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "dump-args.js"),
      "console.log(JSON.stringify(process.argv.slice(2)));\n"
    );
    const shimPath = path.join(dir, "argv-dump.cmd");
    fs.writeFileSync(shimPath, "@node \"%~dp0dump-args.js\" %*\r\n");

    const cliArgs = [
      "--print",
      "--system-prompt",
      "MARKER-BANANA-42: Du bist ein hilfreicher Tagger",
      "--empty",
      "",
      "--quoted",
      "he said \"hi\""
    ];
    const resolved = resolveSpawnForPlatform(shimPath, cliArgs, "win32");
    const result = spawnSync(resolved.command, resolved.args, {
      windowsVerbatimArguments: resolved.windowsVerbatimArguments,
      encoding: "utf8"
    });

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout.trim()), cliArgs);
  }
);
