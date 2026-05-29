import test from "node:test";
import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AddressInfo } from "node:net";
import type { IncomingMessage, ServerResponse } from "node:http";
import { runDirectApiPrompt, streamDirectApiPrompt } from "../src/index.js";

type CapturedRequest = {
  method?: string;
  url?: string;
  headers: IncomingMessage["headers"];
  body: unknown;
};

async function startFakeAnthropic(handler: (request: CapturedRequest, response: ServerResponse) => void) {
  const requests: CapturedRequest[] = [];
  const server = createHttpServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.from(chunk));
    }

    const rawBody = Buffer.concat(chunks).toString("utf8");
    const captured = {
      method: request.method,
      url: request.url,
      headers: request.headers,
      body: rawBody ? JSON.parse(rawBody) : null
    };
    requests.push(captured);
    handler(captured, response);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  assert.equal(typeof address, "object");
  assert.ok(address);
  const port = (address as AddressInfo).port;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close() {
      return new Promise<void>((resolve, reject) => {
        server.close(error => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  };
}

function writeCredentialsFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "direct-api-test-"));
  const credentialsPath = path.join(dir, ".credentials.json");
  fs.writeFileSync(
    credentialsPath,
    JSON.stringify({
      claudeAiOauth: {
        accessToken: "test-access-token"
      }
    })
  );
  return credentialsPath;
}

test("runDirectApiPrompt maps prompts to Anthropic messages without spawning Claude Code", async () => {
  const credentialsPath = writeCredentialsFile();
  const upstream = await startFakeAnthropic((request, response) => {
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/v1/messages");
    assert.equal(request.headers.authorization, "Bearer test-access-token");
    assert.equal(request.headers["anthropic-version"], "2023-06-01");
    assert.match(String(request.headers["anthropic-beta"] || ""), /oauth-2025-04-20/);
    assert.equal(request.headers["x-app"], "cli");
    assert.equal(request.headers["anthropic-dangerous-direct-browser-access"], "true");
    assert.equal(request.headers["x-stainless-lang"], "js");
    assert.equal(request.headers["x-stainless-runtime"], "node");
    assert.deepEqual(request.body, {
      model: "claude-sonnet-4-6",
      system: [
        {
          type: "text",
          text: "You are Claude Code, Anthropic's official CLI for Claude."
        },
        {
          type: "text",
          text: "Answer with one word.",
          cache_control: {
            type: "ephemeral",
            ttl: "1h"
          }
        }
      ],
      messages: [{ role: "user", content: "say hi" }],
      max_tokens: 5,
      stream: false
    });

    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        id: "msg_fake",
        model: "claude-sonnet-4-6",
        content: [{ type: "text", text: "Hi" }],
        usage: {
          input_tokens: 8,
          cache_creation_input_tokens: 2,
          cache_read_input_tokens: 3,
          output_tokens: 1
        }
      })
    );
  });

  try {
    const result = await runDirectApiPrompt("say hi", {
      model: "claude-sonnet-4-6",
      credentialsPath,
      directApiBaseUrl: upstream.url,
      systemPrompt: "Answer with one word.",
      maxTokens: 5
    });

    assert.equal(result.content, "Hi");
    assert.equal(result.usage.totalTokens, 14);
    assert.equal(upstream.requests.length, 1);
  } finally {
    await upstream.close();
  }
});

test("runDirectApiPrompt sends the Claude Code identity block even without caller system prompt", async () => {
  const credentialsPath = writeCredentialsFile();
  const upstream = await startFakeAnthropic((request, response) => {
    assert.deepEqual((request.body as { system?: unknown }).system, [
      {
        type: "text",
        text: "You are Claude Code, Anthropic's official CLI for Claude.",
        cache_control: {
          type: "ephemeral",
          ttl: "1h"
        }
      }
    ]);
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        id: "msg_fake",
        model: "claude-sonnet-4-6",
        content: [{ type: "text", text: "Hi" }],
        usage: {
          input_tokens: 8,
          output_tokens: 1
        }
      })
    );
  });

  try {
    const result = await runDirectApiPrompt("say hi", {
      model: "claude-sonnet-4-6",
      credentialsPath,
      directApiBaseUrl: upstream.url,
      maxTokens: 5
    });

    assert.equal(result.content, "Hi");
  } finally {
    await upstream.close();
  }
});

test("streamDirectApiPrompt converts Anthropic SSE text deltas", async () => {
  const credentialsPath = writeCredentialsFile();
  const upstream = await startFakeAnthropic((_request, response) => {
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache"
    });
    response.write(
      [
        "event: message_start",
        'data: {"type":"message_start","message":{"id":"msg_stream","model":"claude-sonnet-4-6","content":[],"usage":{"input_tokens":4}}}',
        "",
        "event: content_block_delta",
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hel"}}',
        "",
        "event: content_block_delta",
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"lo"}}',
        "",
        "event: message_delta",
        'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}',
        "",
        "event: message_stop",
        'data: {"type":"message_stop"}',
        "",
        ""
      ].join("\n")
    );
    response.end();
  });

  try {
    const deltas: string[] = [];
    let completedText = "";
    for await (const event of streamDirectApiPrompt("say hello", {
      credentialsPath,
      directApiBaseUrl: upstream.url,
      maxTokens: 5
    })) {
      if (event.type === "response.output_text.delta") {
        deltas.push(event.delta);
      }
      if (event.type === "response.completed") {
        completedText = event.response.content;
      }
    }

    assert.deepEqual(deltas, ["Hel", "lo"]);
    assert.equal(completedText, "Hello");
  } finally {
    await upstream.close();
  }
});
