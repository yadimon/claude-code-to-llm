import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
const corePackageJson = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "..", "claude-code-to-llm", "package.json"), "utf8")
);

test("package.json exposes server dist entrypoints and workspace dependency", () => {
  assert.equal(packageJson.name, "@yadimon/claude-code-to-llm-server");
  assert.equal(packageJson.bin["claude-code-to-llm-server"], "dist/cli.js");
  assert.equal(packageJson.main, "./dist/index.js");
  assert.equal(packageJson.types, "./dist/index.d.ts");
  assert.match(packageJson.scripts.build, /maxRetries: 10/);
  assert.match(packageJson.scripts.build, /retryDelay: 50/);
  assert.match(packageJson.scripts.build, /\.tsbuildinfo/);
  assert.equal(packageJson.dependencies["@yadimon/claude-code-to-llm"], `^${corePackageJson.version}`);
  assert.equal(packageJson.scripts.e2e, "tsx ./scripts/e2e-server.ts");
  assert.equal(packageJson.scripts["start:mock"], "tsx ./scripts/start-mock-server.ts");
  assert.equal(packageJson.scripts["test:docker"], "tsx ./scripts/docker-e2e.ts");
});

test("published files include docker assets only", () => {
  assert.deepEqual(packageJson.files, ["dist", "README.md", "LICENSE", "Dockerfile"]);
  assert.equal(fs.existsSync(path.join(process.cwd(), "Dockerfile")), true);
});

test("tsconfig writes the build info file outside dist", () => {
  const tsconfig = JSON.parse(fs.readFileSync(path.join(process.cwd(), "tsconfig.json"), "utf8")) as {
    compilerOptions: { tsBuildInfoFile?: string };
  };
  const buildInfoPath = tsconfig.compilerOptions.tsBuildInfoFile || "";
  assert.ok(buildInfoPath.length > 0, "tsBuildInfoFile must be configured");
  assert.equal(buildInfoPath.startsWith("dist/"), false, "build info must not live inside dist");
});

