# Custodian — MCP server + OAuth 2.1 AS + recall sweeper, one container.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/ui/package.json packages/ui/
COPY infra/package.json infra/
RUN npm ci --no-audit --no-fund
COPY tsconfig.base.json tsconfig.json vitest.config.ts ./
COPY packages ./packages
RUN npm run build -w @custodian/ui

FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app /app
EXPOSE 3001
USER node
CMD ["npx", "tsx", "packages/server/src/index.ts"]
