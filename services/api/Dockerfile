FROM oven/bun:1 AS base
WORKDIR /app

FROM base AS source
COPY . .

FROM base AS prune
RUN bun install --global turbo
COPY --from=source /app .
RUN turbo prune @keeper.sh/api --docker

FROM base AS build
COPY --from=prune /app/out/json/ .
RUN bun install --frozen-lockfile
COPY --from=prune /app/out/full/ .
RUN bun run --cwd services/api build

FROM base AS runtime
COPY --from=prune /app/out/json/ .
RUN bun install --frozen-lockfile --production
COPY --from=build /app/services/api/dist ./services/api/dist
COPY --from=build /app/packages/database/src ./packages/database/src
COPY --from=source /app/packages/database/scripts ./packages/database/scripts
COPY --from=source /app/packages/database/drizzle ./packages/database/drizzle
COPY --from=source /app/services/api/entrypoint.sh ./services/api/entrypoint.sh
RUN chmod +x ./services/api/entrypoint.sh

ENV DEV=production
EXPOSE 3001

ENTRYPOINT ["./services/api/entrypoint.sh"]
