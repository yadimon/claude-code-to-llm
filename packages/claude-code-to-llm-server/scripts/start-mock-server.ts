process.env.CLAUDE_CODE_TO_LLM_SERVER_MOCK_MODE = process.env.CLAUDE_CODE_TO_LLM_SERVER_MOCK_MODE || "1";

const { main } = await import("../src/cli.js");
await main();

export {};
