FROM oven/bun:1 AS base
WORKDIR /app

FROM base AS source
COPY . .

FROM base AS prune
RUN bun install --global turbo
COPY --from=source /app .
RUN turbo prune @keeper.sh/mcp --docker

FROM base AS build
COPY --from=prune /app/out/json/ .
RUN bun install --frozen-lockfile
COPY --from=prune /app/out/full/ .
RUN bun run --cwd applications/mcp build

FROM base AS runtime
COPY --from=prune /app/out/json/ .
RUN bun install --frozen-lockfile --production
COPY --from=build /app/applications/mcp/dist ./applications/mcp/dist
COPY --from=source /app/applications/mcp/entrypoint.sh ./applications/mcp/entrypoint.sh
RUN chmod +x ./applications/mcp/entrypoint.sh

ENV ENV=production
EXPOSE 3002

ENTRYPOINT ["./applications/mcp/entrypoint.sh"]
