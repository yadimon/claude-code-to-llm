import test from "node:test";
import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AddressInfo } from "node:net";
import type { IncomingMessage, ServerResponse } from "node:http";
import { startServer } from "../src/index.js";

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-oauth-test-"));
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

test("claude-oauth backend maps Responses requests to Anthropic messages", async () => {
  const credentialsPath = writeCredentialsFile();
  const upstream = await startFakeAnthropic((request, response) => {
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/v1/messages");
    assert.equal(request.headers.authorization, "Bearer test-access-token");
    assert.equal(request.headers["anthropic-version"], "2023-06-01");
    assert.match(String(request.headers["anthropic-beta"] || ""), /oauth-2025-04-20/);
    assert.equal(request.headers["x-app"], "cli");
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
        role: "assistant",
        content: [{ type: "text", text: "Hi" }],
        stop_reason: "end_turn",
        usage: {
          input_tokens: 8,
          cache_creation_input_tokens: 2,
          cache_read_input_tokens: 3,
          output_tokens: 1
        }
      })
    );
  });
  const started = await startServer({
    host: "127.0.0.1",
    port: 0,
    backend: "claude-oauth",
    credentialsPath,
    claudeOAuthBaseUrl: upstream.url
  });

  try {
    const response = await fetch(`${started.url}/v1/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        instructions: "Answer with one word.",
        input: "say hi",
        max_output_tokens: 5
      })
    });
    const responseJson = (await response.json()) as {
      output_text: string;
      usage: { input_tokens: number; output_tokens: number; total_tokens: number };
    };

    assert.equal(response.status, 200);
    assert.equal(responseJson.output_text, "Hi");
    assert.deepEqual(responseJson.usage, {
      input_tokens: 8,
      input_tokens_details: {
        cached_tokens: 3
      },
      output_tokens: 1,
      total_tokens: 14
    });
    assert.equal(upstream.requests.length, 1);
  } finally {
    await started.close();
    await upstream.close();
  }
});

test("claude-oauth backend converts Anthropic SSE text deltas to Responses SSE", async () => {
  const credentialsPath = writeCredentialsFile();
  const upstream = await startFakeAnthropic((request, response) => {
    assert.equal((request.body as { stream?: boolean }).stream, true);
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache"
    });
    response.write(
      [
        "event: message_start",
        'data: {"type":"message_start","message":{"id":"msg_stream","model":"claude-sonnet-4-6","content":[],"usage":{"input_tokens":4}}}',
        "",
        "event: content_block_start",
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
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
  const started = await startServer({
    host: "127.0.0.1",
    port: 0,
    backend: "claude-oauth",
    credentialsPath,
    claudeOAuthBaseUrl: upstream.url
  });

  try {
    const response = await fetch(`${started.url}/v1/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stream: true,
        input: "say hello",
        max_output_tokens: 5
      })
    });
    const text = await response.text();

    assert.equal(response.status, 200);
    assert.match(text, /event: response.created/);
    assert.match(text, /"delta":"Hel"/);
    assert.match(text, /"delta":"lo"/);
    assert.match(text, /event: response.completed/);
    assert.match(text, /"output_text":"Hello"/);
    assert.match(text, /data: \[DONE\]/);
  } finally {
    await started.close();
    await upstream.close();
  }
});

test("claude-oauth backend includes upstream status in non-stream errors", async () => {
  const credentialsPath = writeCredentialsFile();
  const upstream = await startFakeAnthropic((_request, response) => {
    response.statusCode = 400;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ error: { message: "Error" } }));
  });
  const started = await startServer({
    host: "127.0.0.1",
    port: 0,
    backend: "claude-oauth",
    credentialsPath,
    claudeOAuthBaseUrl: upstream.url
  });

  try {
    const response = await fetch(`${started.url}/v1/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: "say hi",
        max_output_tokens: 5
      })
    });
    const text = await response.text();

    assert.equal(response.status, 500);
    assert.match(text, /HTTP 400/);
    assert.match(text, /Error/);
  } finally {
    await started.close();
    await upstream.close();
  }
});

test("claude-oauth backend rejects web_search instead of silently ignoring it", async () => {
  const credentialsPath = writeCredentialsFile();
  const started = await startServer({
    host: "127.0.0.1",
    port: 0,
    backend: "claude-oauth",
    credentialsPath,
    claudeOAuthBaseUrl: "http://127.0.0.1:1"
  });

  try {
    const response = await fetch(`${started.url}/v1/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: "say hi",
        web_search: true
      })
    });
    const text = await response.text();

    assert.equal(response.status, 400);
    assert.match(text, /web_search is not supported by claude-oauth/);
  } finally {
    await started.close();
  }
});
