import * as fs from "node:fs";
import * as path from "node:path";
import type { ImageInput, ImageMediaType } from "./types.js";

export const SUPPORTED_IMAGE_MEDIA_TYPES: readonly ImageMediaType[] = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp"
];
export const MAX_IMAGE_COUNT = 100;
export const MAX_IMAGE_BASE64_BYTES = 10 * 1024 * 1024;
export const MAX_TOTAL_IMAGE_BYTES = 20 * 1024 * 1024;

const SUPPORTED_MEDIA_TYPES = new Set<string>(SUPPORTED_IMAGE_MEDIA_TYPES);

export type AnthropicImageBlock = {
  type: "image";
  source:
    | {
        type: "base64";
        media_type: ImageMediaType;
        data: string;
      }
    | {
        type: "url";
        url: string;
      };
};

export type AnthropicTextBlock = {
  type: "text";
  text: string;
};

export function normalizeImageInputs(
  images: ImageInput[] | undefined,
  options: { baseDir?: string } = {}
): AnthropicImageBlock[] {
  if (images == null) {
    return [];
  }
  if (!Array.isArray(images)) {
    throw new Error("Invalid images: expected an array");
  }
  if (images.length > MAX_IMAGE_COUNT) {
    throw new Error(`Too many images: maximum is ${MAX_IMAGE_COUNT}`);
  }

  let totalBytes = 0;
  return images.map((image, index) => {
    if (!image || typeof image !== "object") {
      throw new Error(`Invalid image at index ${index}: expected an object`);
    }

    if (image.type === "url") {
      return {
        type: "image",
        source: {
          type: "url",
          url: normalizeImageUrl(image.url, `image at index ${index}`)
        }
      };
    }

    if (image.type === "base64") {
      const mediaType = normalizeImageMediaType(image.mediaType, `image at index ${index}`);
      assertBase64Size(image.data.length, `image at index ${index}`);
      const decoded = decodeBase64Image(image.data, `image at index ${index}`);
      assertDetectedMediaType(decoded, mediaType, `image at index ${index}`);
      totalBytes = addImageBytes(totalBytes, image.data.length);
      return {
        type: "image",
        source: {
          type: "base64",
          media_type: mediaType,
          data: image.data
        }
      };
    }

    if (image.type === "file") {
      if (typeof image.path !== "string" || !image.path.trim()) {
        throw new Error(`Invalid image at index ${index}: file path must not be empty`);
      }
      const filePath = path.resolve(options.baseDir || process.cwd(), image.path);
      let stats: fs.Stats;
      try {
        stats = fs.statSync(filePath);
      } catch {
        throw new Error(`Image file not found: ${filePath}`);
      }
      if (!stats.isFile()) {
        throw new Error(`Image path is not a file: ${filePath}`);
      }
      const encodedSize = Math.ceil(stats.size / 3) * 4;
      assertBase64Size(encodedSize, `image file ${filePath}`);
      const data = fs.readFileSync(filePath);
      const detectedMediaType = detectImageMediaType(data);
      if (!detectedMediaType) {
        throw new Error(`Unsupported or invalid image file: ${filePath}`);
      }
      if (image.mediaType) {
        const declaredMediaType = normalizeImageMediaType(image.mediaType, `image file ${filePath}`);
        if (declaredMediaType !== detectedMediaType) {
          throw new Error(
            `Image media type mismatch for ${filePath}: declared ${declaredMediaType}, detected ${detectedMediaType}`
          );
        }
      }
      totalBytes = addImageBytes(totalBytes, encodedSize);
      return {
        type: "image",
        source: {
          type: "base64",
          media_type: detectedMediaType,
          data: data.toString("base64")
        }
      };
    }

    throw new Error(`Invalid image at index ${index}: unsupported image type`);
  });
}

export function createMultimodalContent(
  prompt: string,
  images: ImageInput[] | undefined,
  options: { baseDir?: string } = {}
): Array<AnthropicImageBlock | AnthropicTextBlock> {
  const content: Array<AnthropicImageBlock | AnthropicTextBlock> = normalizeImageInputs(
    images,
    options
  );
  if (prompt.trim()) {
    content.push({
      type: "text",
      text: prompt
    });
  }
  return content;
}

export function parseImageDataUrl(value: string, label = "image_url"): ImageInput {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/i.exec(value.trim());
  if (!match) {
    throw new Error(`${label} must be a valid base64 image data URL`);
  }
  const mediaType = normalizeImageMediaType(match[1].toLowerCase(), label);
  const data = match[2];
  assertBase64Size(data.length, label);
  const decoded = decodeBase64Image(data, label);
  assertDetectedMediaType(decoded, mediaType, label);
  return {
    type: "base64",
    mediaType,
    data
  };
}

export function normalizeImageUrl(value: string, label = "image URL"): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} URL must not be empty`);
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`${label} must use https`);
  }
  if (!parsed.hostname) {
    throw new Error(`${label} must include a hostname`);
  }
  return parsed.toString();
}

export function normalizeImageMediaType(value: string, label = "image"): ImageMediaType {
  if (!SUPPORTED_MEDIA_TYPES.has(value)) {
    throw new Error(
      `${label} has unsupported media type: expected image/jpeg, image/png, image/gif, or image/webp`
    );
  }
  return value as ImageMediaType;
}

export function detectImageMediaType(data: Uint8Array): ImageMediaType | undefined {
  if (
    data.length >= 8 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47 &&
    data[4] === 0x0d &&
    data[5] === 0x0a &&
    data[6] === 0x1a &&
    data[7] === 0x0a
  ) {
    return "image/png";
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    data.length >= 6 &&
    data[0] === 0x47 &&
    data[1] === 0x49 &&
    data[2] === 0x46 &&
    data[3] === 0x38 &&
    (data[4] === 0x37 || data[4] === 0x39) &&
    data[5] === 0x61
  ) {
    return "image/gif";
  }
  if (
    data.length >= 12 &&
    data[0] === 0x52 &&
    data[1] === 0x49 &&
    data[2] === 0x46 &&
    data[3] === 0x46 &&
    data[8] === 0x57 &&
    data[9] === 0x45 &&
    data[10] === 0x42 &&
    data[11] === 0x50
  ) {
    return "image/webp";
  }
  return undefined;
}

function decodeBase64Image(data: string, label: string): Buffer {
  if (typeof data !== "string" || !data) {
    throw new Error(`${label} base64 data must not be empty`);
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data) || data.length % 4 === 1) {
    throw new Error(`${label} contains malformed base64 data`);
  }
  const decoded = Buffer.from(data, "base64");
  if (!decoded.length || decoded.toString("base64").replace(/=+$/, "") !== data.replace(/=+$/, "")) {
    throw new Error(`${label} contains malformed base64 data`);
  }
  return decoded;
}

function assertDetectedMediaType(data: Uint8Array, mediaType: ImageMediaType, label: string): void {
  const detectedMediaType = detectImageMediaType(data);
  if (!detectedMediaType) {
    throw new Error(`${label} contains an unsupported or invalid image`);
  }
  if (detectedMediaType !== mediaType) {
    throw new Error(
      `${label} media type mismatch: declared ${mediaType}, detected ${detectedMediaType}`
    );
  }
}

function assertBase64Size(bytes: number, label: string): void {
  if (bytes > MAX_IMAGE_BASE64_BYTES) {
    throw new Error(`${label} exceeds the ${MAX_IMAGE_BASE64_BYTES}-byte base64 image limit`);
  }
}

function addImageBytes(current: number, bytes: number): number {
  const total = current + bytes;
  if (total > MAX_TOTAL_IMAGE_BYTES) {
    throw new Error(`Images exceed the ${MAX_TOTAL_IMAGE_BYTES}-byte total limit`);
  }
  return total;
}
