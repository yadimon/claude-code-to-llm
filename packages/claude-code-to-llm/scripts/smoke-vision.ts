import assert from "node:assert/strict";
import { runPrompt } from "../src/index.js";

const BLUE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAb0lEQVR4nO3PAQkAAAyEwO9feoshgnABdNvJ8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ2oPcf88OIhvJ6vAAAAAElFTkSuQmCC";

const result = await runPrompt(
  "Identify the solid color in the image. Reply with exactly one lowercase English color word.",
  {
    maxTokens: 20,
    images: [{ type: "base64", mediaType: "image/png", data: BLUE_PNG_BASE64 }]
  }
);

assert.match(result.content.trim(), /^blue[.!]?$/i, `Expected blue, received: ${result.content}`);

const urlResult = await runPrompt(
  "Is this the TypeScript logo? Reply with exactly yes or no.",
  {
    maxTokens: 20,
    images: [
      {
        type: "url",
        url: "https://raw.githubusercontent.com/github/explore/main/topics/typescript/typescript.png"
      }
    ]
  }
);
assert.match(urlResult.content.trim(), /^yes[.!]?$/i, `Expected yes, received: ${urlResult.content}`);
console.log(
  JSON.stringify(
    {
      ok: true,
      model: result.model,
      base64Content: result.content,
      urlContent: urlResult.content,
      usage: result.usage
    },
    null,
    2
  )
);
