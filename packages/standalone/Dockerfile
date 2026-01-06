ARG S6_OVERLAY_VERSION=3.2.0.2

FROM oven/bun:1 AS base
WORKDIR /app

FROM base AS source
COPY . .

FROM base AS prune
RUN bun install --global turbo
COPY --from=source /app .
RUN turbo prune @keeper.sh/api @keeper.sh/cron @keeper.sh/web --docker

FROM base AS build
COPY --from=prune /app/out/json/ .
RUN bun install --frozen-lockfile
COPY --from=prune /app/out/full/ .
ENV NEXT_PUBLIC_COMMERCIAL_MODE=false
RUN bun run --cwd packages/api build && \
    bun run --cwd packages/cron build && \
    bun run --cwd packages/web build

FROM debian:bookworm-slim AS runtime

ARG S6_OVERLAY_VERSION
ARG TARGETARCH

RUN apt-get update && apt-get install -y --no-install-recommends \
  ca-certificates \
  curl \
  gnupg \
  lsb-release \
  xz-utils \
  unzip \
  && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/postgresql-keyring.gpg \
  && echo "deb [signed-by=/usr/share/keyrings/postgresql-keyring.gpg] http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends postgresql-17 \
  && rm -rf /var/lib/apt/lists/*

RUN apt-get update && apt-get install -y --no-install-recommends redis-server \
  && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://caddyserver.com/api/download?os=linux\&arch=${TARGETARCH} -o /usr/bin/caddy \
  && chmod +x /usr/bin/caddy

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

COPY --from=prune /app/out/json/ .
RUN bun install --frozen-lockfile --production

COPY --from=build /app/packages/api/dist ./packages/api/dist
COPY --from=build /app/packages/cron/dist ./packages/cron/dist
COPY --from=build /app/packages/database/src ./packages/database/src
COPY --from=source /app/packages/database/scripts ./packages/database/scripts
COPY --from=source /app/packages/database/drizzle ./packages/database/drizzle

COPY --from=build /app/packages/web/.next/standalone ./
COPY --from=build /app/packages/web/.next/static ./packages/web/.next/static
COPY --from=build /app/packages/web/public ./packages/web/public

COPY packages/standalone/rootfs /

RUN chmod +x /etc/s6-overlay/s6-rc.d/*/run /etc/s6-overlay/scripts/* \
  && mkdir -p /var/lib/postgresql/data /run/postgresql /var/log/keeper \
  && chown -R postgres:postgres /var/lib/postgresql /run/postgresql

ENV NODE_ENV=production
ENV S6_KEEP_ENV=1
ENV S6_BEHAVIOUR_IF_STAGE2_FAILS=2
ENV S6_CMD_WAIT_FOR_SERVICES_MAXTIME=60000

ENV DATABASE_URL=postgresql://keeper:keeper@localhost:5432/keeper
ENV REDIS_URL=redis://localhost:6379
ENV API_PORT=3001
ENV COMMERCIAL_MODE=false
ENV BETTER_AUTH_URL=http://localhost
ENV API_URL=http://127.0.0.1:3001

EXPOSE 80

VOLUME ["/var/lib/postgresql/data"]

HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 \
  CMD curl -f http://localhost/ || exit 1

ENTRYPOINT ["/init"]
