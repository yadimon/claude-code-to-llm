import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  MAX_IMAGE_COUNT,
  detectImageMediaType,
  normalizeImageInputs,
  normalizeImageUrl,
  parseImageDataUrl
} from "../src/index.js";
import type { ImageInput } from "../src/index.js";

const RED_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC";

test("parseImageDataUrl validates and extracts supported images", () => {
  assert.deepEqual(parseImageDataUrl(`data:image/png;base64,${RED_PNG_BASE64}`), {
    type: "base64",
    mediaType: "image/png",
    data: RED_PNG_BASE64
  });
  assert.equal(detectImageMediaType(Buffer.from(RED_PNG_BASE64, "base64")), "image/png");
});

test("normalizeImageInputs handles base64, URLs, and local files", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-code-to-llm-images-"));
  const imagePath = path.join(tempDir, "red.png");
  fs.writeFileSync(imagePath, Buffer.from(RED_PNG_BASE64, "base64"));

  try {
    const blocks = normalizeImageInputs(
      [
        { type: "base64", mediaType: "image/png", data: RED_PNG_BASE64 },
        { type: "url", url: "https://example.com/image.png" },
        { type: "file", path: "red.png" }
      ],
      { baseDir: tempDir }
    );

    assert.equal(blocks.length, 3);
    assert.equal(blocks[0].source.type, "base64");
    assert.deepEqual(blocks[1], {
      type: "image",
      source: { type: "url", url: "https://example.com/image.png" }
    });
    assert.deepEqual(blocks[2], blocks[0]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("image normalization rejects unsafe or malformed inputs", () => {
  assert.throws(() => normalizeImageUrl("file:///secret.png"), /must use https/);
  assert.throws(() => normalizeImageUrl("http://example.com/image.png"), /must use https/);
  assert.throws(() => parseImageDataUrl("data:image/png,not-base64"), /valid base64/);
  assert.throws(
    () => parseImageDataUrl(`data:image/jpeg;base64,${RED_PNG_BASE64}`),
    /media type mismatch/
  );
  assert.throws(
    () =>
      normalizeImageInputs(
        Array.from({ length: MAX_IMAGE_COUNT + 1 }, () => ({
          type: "url",
          url: "https://example.com/image.png"
        })) as ImageInput[]
      ),
    /Too many images/
  );
  assert.throws(
    () =>
      normalizeImageInputs([
        {
          type: "base64",
          mediaType: "image/png",
          data: "A".repeat(10 * 1024 * 1024 + 1)
        }
      ]),
    /exceeds the .* base64 image limit/
  );
  assert.throws(
    () =>
      normalizeImageInputs([
        { type: "base64", mediaType: "image/png", data: "AAAA=" }
      ]),
    /malformed base64/
  );
});
