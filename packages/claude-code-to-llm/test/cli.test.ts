import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { HELP_TEXT, normalizeCliImage } from "../src/cli.js";
import { createCliArgReader } from "../src/cli-args.js";

test("CLI help text documents JSON and streaming options", () => {
  assert.match(HELP_TEXT, /claude-code-to-llm/);
  assert.match(HELP_TEXT, /--input-file <path>/);
  assert.match(HELP_TEXT, /--image <path\|url\|data-url>/);
  assert.match(HELP_TEXT, /--stream/);
  assert.match(HELP_TEXT, /--verbose/);
  assert.match(HELP_TEXT, /--search/);
  assert.match(HELP_TEXT, /--direct-api-call/);
  assert.match(HELP_TEXT, /--accept-direct-api-call-risk/);
});

test("CLI exits with code 1 and prints an error when input is missing", () => {
  const result = spawnSync(process.execPath, ["--import", "tsx/esm", "./src/cli.ts"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Prompt input is required/);
});

test("CLI direct API mode requires explicit risk confirmation", () => {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx/esm", "./src/cli.ts", "--direct-api-call", "--prompt", "Hi"],
    {
      cwd: process.cwd(),
      encoding: "utf8"
    }
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /accept.*direct API call risk/i);
});

test("CLI parses repeated image inputs", () => {
  const reader = createCliArgReader([
    "--image",
    "one.png",
    "--prompt",
    "compare",
    "--image",
    "https://example.com/two.jpg"
  ]);
  assert.deepEqual(reader.getArgs("--image"), ["one.png", "https://example.com/two.jpg"]);
  assert.deepEqual(normalizeCliImage("one.png"), { type: "file", path: "one.png" });
  assert.deepEqual(normalizeCliImage("https://example.com/two.jpg"), {
    type: "url",
    url: "https://example.com/two.jpg"
  });
});
