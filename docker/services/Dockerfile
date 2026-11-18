ARG S6_OVERLAY_VERSION=3.2.0.2
ARG S6_OVERLAY_NOARCH_SHA256=6dbcde158a3e78b9bb141d7bcb5ccb421e563523babbe2c64470e76f4fd02dae
ARG S6_OVERLAY_X86_64_SHA256=59289456ab1761e277bd456a95e737c06b03ede99158beb24f12b165a904f478
ARG S6_OVERLAY_AARCH64_SHA256=8b22a2eaca4bf0b27a43d36e65c89d2701738f628d1abd0cea5569619f66f785

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
RUN turbo prune @keeper.sh/api @keeper.sh/cron @keeper.sh/worker @keeper.sh/web --docker

FROM base AS build
COPY --from=prune /app/out/json/ .
RUN bun install --frozen-lockfile
COPY --from=prune /app/out/full/ .
RUN bun run --cwd services/api build && \
    bun run --cwd services/cron build && \
    bun run --cwd services/worker build && \
    bun run --cwd applications/web build

FROM debian:bookworm-slim@sha256:734a72b3d6142a71993b4bc580ca01d8ca687f77a2c422d96a961d3376b179bc AS runtime
COPY --from=source /app/docker/icu-timezone /usr/share/icu-timezone
ENV ICU_TIMEZONE_FILES_DIR=/usr/share/icu-timezone

ARG S6_OVERLAY_VERSION
ARG S6_OVERLAY_NOARCH_SHA256
ARG S6_OVERLAY_X86_64_SHA256
ARG S6_OVERLAY_AARCH64_SHA256
ARG TARGETARCH

RUN apt-get update && apt-get install -y --no-install-recommends \
  ca-certificates \
  curl \
  xz-utils \
  && rm -rf /var/lib/apt/lists/*

COPY --from=base /usr/local/bin/bun /usr/local/bin/bun

RUN case "${TARGETARCH}" in \
  amd64) S6_ARCH="x86_64"; S6_ARCH_SHA256="${S6_OVERLAY_X86_64_SHA256}" ;; \
  arm64) S6_ARCH="aarch64"; S6_ARCH_SHA256="${S6_OVERLAY_AARCH64_SHA256}" ;; \
  *) echo "Unsupported architecture: ${TARGETARCH}" && exit 1 ;; \
  esac \
  && curl -fsSL "https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-noarch.tar.xz" -o /tmp/s6-overlay-noarch.tar.xz \
  && curl -fsSL "https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-${S6_ARCH}.tar.xz" -o /tmp/s6-overlay-arch.tar.xz \
  && echo "${S6_OVERLAY_NOARCH_SHA256}  /tmp/s6-overlay-noarch.tar.xz" | sha256sum -c - \
  && echo "${S6_ARCH_SHA256}  /tmp/s6-overlay-arch.tar.xz" | sha256sum -c - \
  && tar -C / -Jxpf /tmp/s6-overlay-noarch.tar.xz \
  && tar -C / -Jxpf /tmp/s6-overlay-arch.tar.xz \
  && rm /tmp/s6-overlay-*.tar.xz

WORKDIR /app

COPY --from=prune /app/out/json/ .
RUN bun install --frozen-lockfile --production

COPY --from=build /app/services/api/dist ./services/api/dist
COPY --from=build /app/services/cron/dist ./services/cron/dist
COPY --from=build /app/services/worker/dist ./services/worker/dist
COPY --from=build /app/packages/database/src ./packages/database/src
COPY --from=build /app/packages/data-schemas/src ./packages/data-schemas/src
COPY --from=source /app/packages/database/scripts ./packages/database/scripts
COPY --from=source /app/packages/database/drizzle ./packages/database/drizzle

COPY --from=build /app/applications/web/dist ./applications/web/dist

COPY docker/services/rootfs /

RUN chmod +x /etc/s6-overlay/s6-rc.d/*/run /etc/s6-overlay/scripts/*

ENV ENV=production
ENV S6_KEEP_ENV=1
ENV S6_BEHAVIOUR_IF_STAGE2_FAILS=2
ENV S6_CMD_WAIT_FOR_SERVICES_MAXTIME=60000

ENV API_PORT=3001
ENV VITE_API_URL=http://127.0.0.1:3001
ENV COMMERCIAL_MODE=false
ENV WORKER_JOB_QUEUE_ENABLED=true

EXPOSE 3000 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f -H "Accept: text/html" http://localhost:3000/ || exit 1

ARG COMMIT_SHA
ARG VERSION
RUN test -n "$COMMIT_SHA" && test -n "$VERSION" || { echo "Build with --build-arg COMMIT_SHA=<git commit> --build-arg VERSION=<release version>" >&2; exit 1; }
ENV COMMIT_SHA=$COMMIT_SHA
ENV VERSION=$VERSION

ENTRYPOINT ["/init"]
