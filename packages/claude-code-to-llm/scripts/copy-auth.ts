import * as fs from "node:fs";
import * as path from "node:path";
import { prepareAuthCopy, resolveDefaultAuthPaths } from "../src/index.js";

const args = process.argv.slice(2);

function getArg(name: string, fallback?: string): string | undefined {
  const inline = args.find(arg => arg.startsWith(`${name}=`));
  if (inline) {
    return inline.slice(name.length + 1);
  }

  const index = args.indexOf(name);
  if (index !== -1 && args[index + 1]) {
    return args[index + 1];
  }

  return fallback;
}

const defaults = resolveDefaultAuthPaths();
const from = getArg("--from", defaults.sessionPath) as string;
const credentialsFrom = getArg("--credentials-from", defaults.credentialsPath);
const positionalTarget = args.find(arg => !arg.startsWith("-"));
const to = getArg(
  "--to",
  positionalTarget || path.join(process.cwd(), ".claude-code-to-llm", ".claude.json")
) as string;

fs.mkdirSync(path.dirname(to), { recursive: true });
const copiedTo = prepareAuthCopy({
  authPath: from,
  credentialsPath: credentialsFrom,
  targetPath: to
});

console.log(copiedTo);
