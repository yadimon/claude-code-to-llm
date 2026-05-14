#!/usr/bin/env node
// Smoke-test freshly published @yadimon/claude-code-to-llm and
// @yadimon/claude-code-to-llm-server packages.
//
// Modes (first arg):
//   core   — install @yadimon/claude-code-to-llm@latest, import main entry, verify exports.
//   server — install @yadimon/claude-code-to-llm-server@latest, import main entry, verify exports.
//   all    — both.
//
// We only do import-level checks (not live LLM calls) because the published-version
// smoke is about packaging health, not runtime correctness — that's covered by the
// per-PR check before merge.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const VERSION = process.env.SMOKE_PUBLISHED_VERSION ?? "latest";

function npm(args, cwd) {
  // On Node >=20 Windows requires shell: true to spawn .cmd / .bat files.
  return execFileSync("npm", args, { cwd, stdio: "inherit", shell: true });
}

async function smokePackage(pkgName, expectedExports) {
  const dir = mkdtempSync(join(tmpdir(), `${pkgName.replace(/[^a-z]/gi, "-")}-smoke-`));
  console.log(`[smoke] ${pkgName} tmp dir: ${dir}`);
  try {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "smoke", private: true, type: "module" }, null, 2),
    );
    console.log(`[smoke] installing ${pkgName}@${VERSION} ...`);
    npm(["install", "--no-audit", "--no-fund", `${pkgName}@${VERSION}`], dir);

    const [scope, name] = pkgName.split("/");
    const installedPkgPath = join(dir, "node_modules", scope, name, "package.json");
    if (!existsSync(installedPkgPath)) {
      throw new Error(`installed package.json missing: ${installedPkgPath}`);
    }
    const installed = JSON.parse(readFileSync(installedPkgPath, "utf8"));
    console.log(`[smoke] installed ${pkgName}@${installed.version}`);

    const entryRel = installed.exports?.["."]?.import?.default
      ?? installed.exports?.["."]?.import
      ?? installed.module
      ?? installed.main;
    if (!entryRel) {
      throw new Error("could not resolve entry from installed package.json");
    }
    const entry = join(dir, "node_modules", scope, name, entryRel);
    if (!existsSync(entry)) {
      throw new Error(`entry file missing: ${entry}`);
    }

    const mod = await import(pathToFileURL(entry).href);
    const exportNames = Object.keys(mod);
    console.log(`[smoke] ${pkgName} exports: ${exportNames.join(", ")}`);
    for (const required of expectedExports) {
      if (!(required in mod)) {
        throw new Error(`${pkgName} missing expected export: ${required}`);
      }
    }
    console.log(`[smoke] ${pkgName}@${installed.version} OK`);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

const mode = process.argv[2] ?? "all";
const tasks = [];
if (mode === "core" || mode === "all") {
  tasks.push(() => smokePackage("@yadimon/claude-code-to-llm", ["runPrompt", "streamPrompt"]));
}
if (mode === "server" || mode === "all") {
  tasks.push(() => smokePackage("@yadimon/claude-code-to-llm-server", ["createServer"]));
}
if (tasks.length === 0) {
  console.error(`unknown mode: ${mode}`);
  process.exit(2);
}

for (const task of tasks) {
  await task();
}
console.log("[smoke] all checks passed");
