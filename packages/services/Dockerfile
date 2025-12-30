ARG S6_OVERLAY_VERSION=3.2.0.2

FROM oven/bun:1 AS foundation
WORKDIR /app

FROM foundation AS prepare
RUN bun install --global turbo
COPY . .
RUN turbo prune @keeper.sh/api @keeper.sh/cron @keeper.sh/web --docker

FROM foundation AS build
RUN bun install --global turbo

COPY --from=prepare /app/out/json/ .
RUN bun install --frozen-lockfile

COPY --from=prepare /app/out/full/ .
ENV NEXT_PUBLIC_COMMERCIAL_MODE=false
RUN turbo build --filter=@keeper.sh/api --filter=@keeper.sh/cron --filter=@keeper.sh/web

FROM debian:bookworm-slim AS runtime

ARG S6_OVERLAY_VERSION
ARG TARGETARCH

RUN apt-get update && apt-get install -y --no-install-recommends \
  ca-certificates \
  curl \
  xz-utils \
  unzip \
  && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

RUN case "${TARGETARCH}" in \
  amd64) S6_ARCH="x86_64" ;; \
  arm64) S6_ARCH="aarch64" ;; \
  *) echo "Unsupported architecture: ${TARGETARCH}" && exit 1 ;; \
  esac \
  && curl -fsSL "https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-noarch.tar.xz" -o /tmp/s6-overlay-noarch.tar.xz \
  && curl -fsSL "https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-${S6_ARCH}.tar.xz" -o /tmp/s6-overlay-arch.tar.xz \
  && tar -C / -Jxpf /tmp/s6-overlay-noarch.tar.xz \
  && tar -C / -Jxpf /tmp/s6-overlay-arch.tar.xz \
  && rm /tmp/s6-overlay-*.tar.xz

WORKDIR /app

RUN bun install --global turbo

COPY --from=prepare /app/out/json/ .
RUN bun install --frozen-lockfile --production

COPY --from=build /app/turbo.json ./turbo.json
COPY --from=build /app/packages/api/turbo.json ./packages/api/turbo.json
COPY --from=build /app/packages/cron/turbo.json ./packages/cron/turbo.json

COPY --from=build /app/packages/api/dist ./packages/api/dist
COPY --from=build /app/packages/cron/dist ./packages/cron/dist
COPY --from=build /app/packages/database ./packages/database

COPY --from=build /app/packages/web/.next/standalone ./
COPY --from=build /app/packages/web/.next/static ./packages/web/.next/static
COPY --from=build /app/packages/web/public ./packages/web/public

COPY packages/services/rootfs /

RUN chmod +x /etc/s6-overlay/s6-rc.d/*/run /etc/s6-overlay/scripts/*

ENV NODE_ENV=production
ENV TURBO_TELEMETRY_DISABLED=1
ENV S6_KEEP_ENV=1
ENV S6_BEHAVIOUR_IF_STAGE2_FAILS=2
ENV S6_CMD_WAIT_FOR_SERVICES_MAXTIME=60000

ENV API_PORT=3001
ENV API_URL=http://127.0.0.1:3001
ENV COMMERCIAL_MODE=false

EXPOSE 3000 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:3000/ || exit 1

ENTRYPOINT ["/init"]
