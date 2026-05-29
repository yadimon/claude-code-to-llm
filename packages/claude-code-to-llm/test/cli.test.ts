import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { HELP_TEXT } from "../src/cli.js";

test("CLI help text documents JSON and streaming options", () => {
  assert.match(HELP_TEXT, /claude-code-to-llm/);
  assert.match(HELP_TEXT, /--input-file <path>/);
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
