FROM oven/bun:1

WORKDIR /app

COPY package.json bun.lock tsconfig.json biome.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/service/package.json packages/service/package.json
COPY packages/cli/package.json packages/cli/package.json
COPY packages/channel/package.json packages/channel/package.json

RUN bun install --frozen-lockfile --production

COPY packages/shared packages/shared
COPY packages/service packages/service

EXPOSE 3000
CMD ["bun", "run", "packages/service/src/index.ts"]
