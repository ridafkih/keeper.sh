FROM oven/bun:1 AS foundation
WORKDIR /app

FROM foundation AS prepare
RUN bun install --global turbo
COPY . .
RUN turbo prune @keeper.sh/web --docker

FROM foundation AS build
RUN bun install --global turbo

COPY --from=prepare /app/out/json/ .
RUN bun install --frozen-lockfile

COPY --from=prepare /app/out/full/ .
RUN turbo build --filter=@keeper.sh/web

FROM foundation AS runtime

COPY --from=build /app/packages/web/.next/standalone ./
COPY --from=build /app/packages/web/.next/static ./packages/web/.next/static
COPY --from=build /app/packages/web/public ./packages/web/public

ENV NODE_ENV=production
ENV TURBO_TELEMETRY_DISABLED=1
EXPOSE 3000

CMD ["bun", "packages/web/server.js"]
