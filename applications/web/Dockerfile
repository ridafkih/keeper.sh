FROM oven/bun:1 AS base
WORKDIR /app

FROM base AS source
COPY . .

FROM base AS prune
RUN bun install --global turbo
COPY --from=source /app .
RUN turbo prune @keeper.sh/web --docker

FROM base AS build
COPY --from=prune /app/out/json/ .
RUN bun install --frozen-lockfile
COPY --from=prune /app/out/full/ .
RUN bun run --cwd applications/web build

FROM base AS runtime
COPY --from=build /app/applications/web/.next/standalone ./
COPY --from=build /app/applications/web/.next/static ./applications/web/.next/static
COPY --from=build /app/applications/web/public ./applications/web/public

ENV NODE_ENV=production
EXPOSE 3000

CMD ["bun", "applications/web/server.js"]
