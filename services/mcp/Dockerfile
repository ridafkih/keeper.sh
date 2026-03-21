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
RUN bun run --cwd services/mcp build

FROM base AS runtime
COPY --from=prune /app/out/json/ .
RUN bun install --frozen-lockfile --production
COPY --from=build /app/services/mcp/dist ./services/mcp/dist
COPY --from=prune /app/out/full/packages/otelemetry ./packages/otelemetry
RUN bun link --cwd packages/otelemetry
COPY --from=source /app/services/mcp/entrypoint.sh ./services/mcp/entrypoint.sh
RUN chmod +x ./services/mcp/entrypoint.sh

ENV ENV=production
EXPOSE 3002

ENTRYPOINT ["./services/mcp/entrypoint.sh"]
