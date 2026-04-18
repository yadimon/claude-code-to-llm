import { runNpm } from "./workspace-helpers.js";

const workspaces = [
  "@yadimon/claude-code-to-llm",
  "@yadimon/claude-code-to-llm-server"
];

for (const workspace of workspaces) {
  runNpm(["run", "lint", "--workspace", workspace]);
}

for (const workspace of workspaces) {
  runNpm(["run", "typecheck", "--workspace", workspace]);
}

for (const workspace of workspaces) {
  runNpm(["run", "test", "--workspace", workspace]);
}

for (const workspace of workspaces) {
  runNpm(["run", "e2e", "--workspace", workspace]);
}

for (const workspace of workspaces) {
  runNpm(["run", "release:check", "--workspace", workspace]);
}

runNpm(["run", "test:docker", "--workspace", "@yadimon/claude-code-to-llm-server"]);
