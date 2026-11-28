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
RUN turbo prune @keeper.sh/worker --docker

FROM base AS build
COPY --from=prune /app/out/json/ .
RUN bun install --frozen-lockfile
COPY --from=prune /app/out/full/ .
RUN bun run --cwd services/worker build

FROM base AS runtime
COPY --from=source /app/docker/icu-timezone /usr/share/icu-timezone
ENV ICU_TIMEZONE_FILES_DIR=/usr/share/icu-timezone
ADD --chmod=644 --checksum=sha256:90a6f1a7978a1b1b096dca6c57511ca48d3b8cf052f8e704baf358f34ea2f21b https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /etc/ssl/certs/rds-global-bundle.pem
COPY --from=prune /app/out/json/ .
RUN bun install --frozen-lockfile --production
COPY --from=build /app/services/worker/dist ./services/worker/dist
COPY --from=prune /app/out/full/packages/otelemetry ./packages/otelemetry
RUN ln -s /app/packages/otelemetry/src/index.ts /usr/local/bin/keeper-otelemetry
COPY --from=source /app/services/worker/entrypoint.sh ./services/worker/entrypoint.sh
RUN chmod +x ./services/worker/entrypoint.sh

ENV ENV=production
ENV STDOUT_LOG_LEVEL=warn

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

ENTRYPOINT ["./services/worker/entrypoint.sh"]
