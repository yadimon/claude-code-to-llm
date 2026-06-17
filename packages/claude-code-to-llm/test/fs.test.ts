import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  cleanupDirectory,
  createClaudeCodeHome,
  prepareAuthCopy,
  runPrompt
} from "../src/index.js";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "claude-code-to-llm-test-"));
}

function writeAuthBundle(rootDir: string): {
  sessionPath: string;
  credentialsPath: string;
  settingsPath: string;
} {
  const sessionPath = path.join(rootDir, ".claude.json");
  const claudeDir = path.join(rootDir, ".claude");
  const credentialsPath = path.join(claudeDir, ".credentials.json");
  const settingsPath = path.join(claudeDir, "settings.json");
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(sessionPath, "{\"oauthAccount\":{\"email\":\"test@example.com\"}}\n", "utf8");
  fs.writeFileSync(credentialsPath, "{\"claudeAiOauth\":{\"accessToken\":\"x\"}}\n", "utf8");
  fs.writeFileSync(settingsPath, "{\"mcpServers\":{\"example\":{}}}\n", "utf8");
  return { sessionPath, credentialsPath, settingsPath };
}

test("prepareAuthCopy copies the Claude auth bundle to the requested target", () => {
  const sourceDir = makeTempDir();
  const targetDir = makeTempDir();
  const { sessionPath, credentialsPath } = writeAuthBundle(sourceDir);
  const targetSessionPath = path.join(targetDir, ".claude.json");

  const copiedTo = prepareAuthCopy({
    authPath: sessionPath,
    credentialsPath,
    targetPath: targetSessionPath
  });

  assert.equal(copiedTo, targetSessionPath);
  assert.equal(
    fs.readFileSync(targetSessionPath, "utf8"),
    "{\"oauthAccount\":{\"email\":\"test@example.com\"}}\n"
  );
  assert.equal(
    fs.readFileSync(path.join(targetDir, ".claude", ".credentials.json"), "utf8"),
    "{\"claudeAiOauth\":{\"accessToken\":\"x\"}}\n"
  );

  cleanupDirectory(sourceDir, true);
  cleanupDirectory(targetDir, true);
});

test("createClaudeCodeHome writes minimal Claude runtime state into the temp home", () => {
  const sourceDir = makeTempDir();
  const configHome = makeTempDir();
  const { sessionPath, credentialsPath } = writeAuthBundle(sourceDir);

  const createdHome = createClaudeCodeHome({
    authPath: sessionPath,
    credentialsPath,
    configHome
  });

  assert.equal(createdHome, configHome);
  assert.equal(fs.readFileSync(path.join(configHome, ".claude.json"), "utf8"), "{}\n");
  assert.equal(
    fs.readFileSync(path.join(configHome, ".claude", ".credentials.json"), "utf8"),
    "{\"claudeAiOauth\":{\"accessToken\":\"x\"}}\n"
  );
  assert.equal(fs.existsSync(path.join(configHome, ".claude", "settings.json")), false);
  assert.equal(
    fs.readFileSync(path.join(configHome, ".claude-code-to-llm-empty-mcp.json"), "utf8"),
    "{\"mcpServers\":{}}\n"
  );

  cleanupDirectory(sourceDir, true);
  cleanupDirectory(configHome, true);
});

test("createClaudeCodeHome copies settings only when explicitly requested", () => {
  const sourceDir = makeTempDir();
  const configHome = makeTempDir();
  const { sessionPath, credentialsPath, settingsPath } = writeAuthBundle(sourceDir);

  createClaudeCodeHome({
    authPath: sessionPath,
    credentialsPath,
    settingsPath,
    configHome
  });

  assert.equal(
    fs.readFileSync(path.join(configHome, ".claude", "settings.json"), "utf8"),
    "{\"mcpServers\":{\"example\":{}}}\n"
  );

  cleanupDirectory(sourceDir, true);
  cleanupDirectory(configHome, true);
});

test("cleanupDirectory removes owned temp directories and ignores disabled cleanup", () => {
  const keepDir = makeTempDir();
  const deleteDir = makeTempDir();

  cleanupDirectory(keepDir, false);
  cleanupDirectory(deleteDir, true);

  assert.equal(fs.existsSync(keepDir), true);
  assert.equal(fs.existsSync(deleteDir), false);

  cleanupDirectory(keepDir, true);
});

test("runPrompt reports a helpful error when the Claude Code CLI is missing", async () => {
  const sourceDir = makeTempDir();
  const workspace = makeTempDir();
  const configHome = makeTempDir();
  const { sessionPath, credentialsPath } = writeAuthBundle(sourceDir);

  await assert.rejects(
    runPrompt("Hi", {
      authPath: sessionPath,
      credentialsPath,
      cliPath: path.join(sourceDir, "missing-claude"),
      configHome,
      cwd: workspace
    }),
    /Claude Code CLI not found/
  );

  cleanupDirectory(sourceDir, true);
  cleanupDirectory(workspace, true);
  cleanupDirectory(configHome, true);
});
