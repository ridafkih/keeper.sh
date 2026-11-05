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
COPY --from=source /app/docker/icu-timezone /usr/share/icu-timezone
ENV ICU_TIMEZONE_FILES_DIR=/usr/share/icu-timezone
COPY --from=prune /app/out/json/ .
RUN bun install --frozen-lockfile --production
COPY --from=build /app/applications/web/dist ./applications/web/dist
COPY --from=build /app/applications/web/public ./applications/web/public
COPY --from=prune /app/out/full/packages/otelemetry ./packages/otelemetry
RUN bun link --cwd packages/otelemetry
COPY --from=source /app/applications/web/entrypoint.sh ./applications/web/entrypoint.sh
RUN chmod +x ./applications/web/entrypoint.sh

WORKDIR /app/applications/web

ENV ENV=production
EXPOSE 3000

ARG COMMIT_SHA
ARG VERSION
RUN test -n "$COMMIT_SHA" && test -n "$VERSION" || { echo "Build with --build-arg COMMIT_SHA=<git commit> --build-arg VERSION=<release version>" >&2; exit 1; }
ENV COMMIT_SHA=$COMMIT_SHA
ENV VERSION=$VERSION

ENTRYPOINT ["./entrypoint.sh"]
