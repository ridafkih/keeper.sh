FROM oven/bun:1.4.4@sha256:1d22548f177f4ff38e0c15baa3c2c46c6c2060ba2d1bc573bb4720b407548f1d AS base
WORKDIR /app

FROM base AS source
COPY . .

FROM base AS prune
COPY --from=source /app/bun.lock ./bun.lock
RUN version="$(sed -n 's/^ *"turbo": \["turbo@\([^"]*\)".*/\1/p' bun.lock)" \
  && test -n "$version" \
  && bun install --global "turbo@$version"
COPY --from=source /app .
RUN turbo prune @keeper.sh/web --docker

FROM base AS build
COPY --from=prune /app/out/json/ .
RUN bun install --frozen-lockfile
COPY --from=prune /app/out/full/ .
RUN ENV=production bun run --cwd applications/web build

FROM base AS runtime
COPY --from=source /app/docker/icu-timezone /usr/share/icu-timezone
ENV ICU_TIMEZONE_FILES_DIR=/usr/share/icu-timezone
COPY --from=prune /app/out/json/ .
RUN bun install --frozen-lockfile --production
COPY --from=build /app/applications/web/dist ./applications/web/dist
COPY --from=build /app/applications/web/public ./applications/web/public
COPY --from=prune /app/out/full/packages/otelemetry ./packages/otelemetry
RUN ln -s /app/packages/otelemetry/src/index.ts /usr/local/bin/keeper-otelemetry
COPY --from=source /app/applications/web/entrypoint.sh ./applications/web/entrypoint.sh
RUN chmod +x ./applications/web/entrypoint.sh

WORKDIR /app/applications/web

ENV ENV=production
EXPOSE 3000

ARG BUILD_REVISION=
ARG BUILD_VERSION=
# Generic build args first, so a build system can stamp this image without
# knowing the repo's names; COMMIT_SHA/VERSION still override them.
ARG COMMIT_SHA=${BUILD_REVISION}
ARG VERSION=${BUILD_VERSION}
RUN test -n "$COMMIT_SHA" && test -n "$VERSION" || { echo "Build with --build-arg COMMIT_SHA=<git commit> --build-arg VERSION=<release version>" >&2; exit 1; }
ENV COMMIT_SHA=$COMMIT_SHA
ENV VERSION=$VERSION

RUN chown 1000:1000 /tmp
USER 1000:1000
VOLUME ["/tmp"]

ENTRYPOINT ["./entrypoint.sh"]
