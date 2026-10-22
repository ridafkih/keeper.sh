FROM oven/bun:1 AS base
WORKDIR /app

FROM base AS source
COPY . .

FROM base AS prune
RUN bun install --global turbo
COPY --from=source /app .
RUN turbo prune @keeper.sh/worker --docker

FROM base AS build
COPY --from=prune /app/out/json/ .
RUN bun install --frozen-lockfile
COPY --from=prune /app/out/full/ .
RUN bun run --cwd services/worker build

FROM base AS runtime
ADD --chmod=644 --checksum=sha256:90a6f1a7978a1b1b096dca6c57511ca48d3b8cf052f8e704baf358f34ea2f21b https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /etc/ssl/certs/rds-global-bundle.pem
COPY --from=prune /app/out/json/ .
RUN bun install --frozen-lockfile --production
COPY --from=build /app/services/worker/dist ./services/worker/dist
COPY --from=prune /app/out/full/packages/otelemetry ./packages/otelemetry
RUN bun link --cwd packages/otelemetry
COPY --from=source /app/services/worker/entrypoint.sh ./services/worker/entrypoint.sh
RUN chmod +x ./services/worker/entrypoint.sh

ENV ENV=production

ENTRYPOINT ["./services/worker/entrypoint.sh"]
