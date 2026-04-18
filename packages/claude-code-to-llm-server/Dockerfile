FROM node:22-bookworm-slim AS build

ARG CLAUDE_CODE_CLI_PACKAGE=@anthropic-ai/claude-code
WORKDIR /app

COPY package.json ./package.json
COPY package-lock.json ./package-lock.json
COPY tsconfig.json ./tsconfig.json
COPY tsconfig.base.json ./tsconfig.base.json
COPY scripts ./scripts
COPY packages ./packages

RUN npm ci
RUN npm run build

FROM node:22-bookworm-slim

ARG CLAUDE_CODE_CLI_PACKAGE=@anthropic-ai/claude-code
ENV NODE_ENV=production
ENV CLAUDE_CODE_TO_LLM_SERVER_HOST=0.0.0.0
ENV CLAUDE_CODE_TO_LLM_SERVER_PORT=3000
WORKDIR /app

COPY package.json ./package.json
COPY package-lock.json ./package-lock.json
COPY packages/claude-code-to-llm/package.json ./packages/claude-code-to-llm/package.json
COPY packages/claude-code-to-llm/README.md ./packages/claude-code-to-llm/README.md
COPY packages/claude-code-to-llm/LICENSE ./packages/claude-code-to-llm/LICENSE
COPY packages/claude-code-to-llm/scripts ./packages/claude-code-to-llm/scripts
COPY packages/claude-code-to-llm-server/package.json ./packages/claude-code-to-llm-server/package.json
COPY packages/claude-code-to-llm-server/README.md ./packages/claude-code-to-llm-server/README.md
COPY packages/claude-code-to-llm-server/LICENSE ./packages/claude-code-to-llm-server/LICENSE
COPY packages/claude-code-to-llm-server/Dockerfile ./packages/claude-code-to-llm-server/Dockerfile
COPY packages/claude-code-to-llm-server/scripts ./packages/claude-code-to-llm-server/scripts

RUN npm ci --omit=dev --workspaces --include-workspace-root false
RUN npm install -g ${CLAUDE_CODE_CLI_PACKAGE}

COPY --from=build /app/packages/claude-code-to-llm/dist ./packages/claude-code-to-llm/dist
COPY --from=build /app/packages/claude-code-to-llm-server/dist ./packages/claude-code-to-llm-server/dist

EXPOSE 3000

CMD ["node", "./packages/claude-code-to-llm-server/dist/cli.js"]
