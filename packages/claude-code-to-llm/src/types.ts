export const DEFAULT_MODEL = "claude-sonnet-4-6";
export const DEFAULT_REASONING_EFFORT = "low";

export type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

export type ImageInput =
  | {
      type: "base64";
      mediaType: ImageMediaType;
      data: string;
    }
  | {
      type: "url";
      url: string;
    }
  | {
      type: "file";
      path: string;
      mediaType?: ImageMediaType;
    };

export interface RunOptions {
  model?: string;
  reasoningEffort?: string;
  maxTokens?: number;
  timeout?: number;
  cliPath?: string;
  authPath?: string;
  credentialsPath?: string;
  settingsPath?: string;
  configHome?: string;
  cwd?: string;
  responseId?: string;
  webSearch?: boolean;
  systemPrompt?: string;
  images?: ImageInput[];
}

export interface NormalizedRunOptions {
  model: string;
  reasoningEffort: string;
  maxTokens?: number;
  timeoutMs: number;
  cliPath: string;
  webSearch: boolean;
  systemPrompt?: string;
  images: ImageInput[];
}

export interface UsageSummary {
  inputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  webSearchRequests: number;
  webFetchRequests: number;
}

export interface CoreResponse {
  id: string;
  model: string;
  prompt: string;
  createdAt: number;
  content: string;
  usage: UsageSummary;
  raw: {
    stderr: string;
    events: unknown[];
  };
}

export type ResponseShell = Omit<CoreResponse, "content" | "usage" | "raw">;

export type StreamEvent =
  | { type: "response.started"; response: ResponseShell }
  | { type: "response.output_text.delta"; delta: string }
  | { type: "response.raw_event"; event: unknown }
  | { type: "response.completed"; response: CoreResponse }
  | { type: "response.failed"; error: { message: string } };

export interface ParsedClaudeEvents {
  content: string;
  usage: UsageSummary;
  events: unknown[];
}

export interface Runner {
  runPrompt(prompt: string, options?: RunOptions): Promise<CoreResponse>;
  streamPrompt(prompt: string, options?: RunOptions): AsyncIterable<StreamEvent>;
}

export interface SpawnResolution {
  command: string;
  args: string[];
  windowsVerbatimArguments?: boolean;
}
