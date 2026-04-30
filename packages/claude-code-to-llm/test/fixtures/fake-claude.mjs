#!/usr/bin/env node

import fs from "node:fs";

const args = process.argv.slice(2);

if (args[0] === "--version") {
  console.log("fake-claude 1.0.0");
  process.exit(0);
}

if (!args.includes("-p") && !args.includes("--print")) {
  console.error(`Unsupported fake Claude command: ${args.join(" ")}`);
  process.exit(1);
}

const stdin = await new Promise((resolve, reject) => {
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", chunk => {
    input += chunk;
  });
  process.stdin.on("end", () => resolve(input));
  process.stdin.on("error", reject);
});

if (process.env.FAKE_CLAUDE_CAPTURE_FILE) {
  fs.writeFileSync(
    process.env.FAKE_CLAUDE_CAPTURE_FILE,
    JSON.stringify({ args, stdin }, null, 2),
    "utf8"
  );
}

if (process.env.FAKE_CLAUDE_TERMINATE_SIGNAL) {
  process.kill(process.pid, process.env.FAKE_CLAUDE_TERMINATE_SIGNAL);
}

const prompt = stdin.trim();
const modelIndex = args.findIndex(arg => arg === "--model");
const model = modelIndex === -1 ? "claude-sonnet-4-6" : args[modelIndex + 1];
const message = `FAKE:${prompt}`;

const events = [
  {
    type: "system",
    subtype: "init",
    model
  },
  {
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "text", text: message }]
    }
  },
  {
    type: "result",
    subtype: "success",
    is_error: false,
    result: message,
    usage: {
      input_tokens: prompt.length,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens: message.length
    }
  }
];

for (const event of events) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}
