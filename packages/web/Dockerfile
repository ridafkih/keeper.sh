FROM oven/bun:1 AS foundation
WORKDIR /app

FROM foundation AS prepare
RUN bun install --global turbo
COPY . .
RUN turbo prune @keeper.sh/web --docker

FROM foundation AS runtime
RUN bun install --global turbo

COPY --from=prepare /app/out/json/ .
COPY --from=prepare /app/out/full/ .
RUN bun install --frozen-lockfile

ENV NODE_ENV=production
ENV TURBO_TELEMETRY_DISABLED=1
EXPOSE 3000

CMD ["turbo", "start"]
