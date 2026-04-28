import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));

test("package.json exposes dist entrypoints and release checks", () => {
  assert.equal(packageJson.name, "@yadimon/claude-code-to-llm");
  assert.equal(packageJson.bin["claude-code-to-llm"], "dist/cli.js");
  assert.equal(packageJson.main, "./dist/index.js");
  assert.equal(packageJson.types, "./dist/index.d.ts");
  assert.match(packageJson.scripts.build, /maxRetries: 10/);
  assert.match(packageJson.scripts.build, /retryDelay: 50/);
  assert.match(packageJson.scripts.build, /\.tsbuildinfo/);
  assert.equal(packageJson.scripts.test, "tsx ./scripts/run-node-tests.ts");
  assert.equal(packageJson.scripts.e2e, "tsx ./scripts/e2e-cli.ts");
  assert.equal(packageJson.scripts.prepack, "npm run test && npm run build");
  assert.equal(packageJson.scripts["release:check"], "tsx ./scripts/release-check.ts");
  assert.equal(packageJson.scripts["smoke:search"], "tsx ./scripts/smoke-search.ts");
  assert.equal(packageJson.engines.node, ">=20");
});

test("published files include dist artifacts and documentation only", () => {
  assert.deepEqual(packageJson.files, ["dist", "README.md", "LICENSE"]);
});

test("tsconfig writes the build info file outside dist", () => {
  const tsconfig = JSON.parse(fs.readFileSync(path.join(process.cwd(), "tsconfig.json"), "utf8")) as {
    compilerOptions: { tsBuildInfoFile?: string };
  };
  const buildInfoPath = tsconfig.compilerOptions.tsBuildInfoFile || "";
  assert.ok(buildInfoPath.length > 0, "tsBuildInfoFile must be configured");
  assert.equal(buildInfoPath.startsWith("dist/"), false, "build info must not live inside dist");
});

test("CLI entry file keeps a portable shebang for npm bin shims", () => {
  const cliSource = fs.readFileSync(path.join(process.cwd(), "src", "cli.ts"), "utf8");

  assert.equal(cliSource.startsWith("#!/usr/bin/env node"), true);
});
