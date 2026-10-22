FROM oven/bun:1 AS base
WORKDIR /app

FROM base AS source
COPY . .

FROM base AS prune
RUN bun install --global turbo
COPY --from=source /app .
RUN turbo prune @keeper.sh/api --docker

FROM base AS build
COPY --from=prune /app/out/json/ .
RUN bun install --frozen-lockfile
COPY --from=prune /app/out/full/ .
RUN bun run --cwd services/api build

FROM base AS runtime
ADD --chmod=644 --checksum=sha256:90a6f1a7978a1b1b096dca6c57511ca48d3b8cf052f8e704baf358f34ea2f21b https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /etc/ssl/certs/rds-global-bundle.pem
COPY --from=prune /app/out/json/ .
RUN bun install --frozen-lockfile --production
COPY --from=build /app/services/api/dist ./services/api/dist
COPY --from=prune /app/out/full/packages/otelemetry ./packages/otelemetry
RUN bun link --cwd packages/otelemetry
COPY --from=build /app/packages/database/src ./packages/database/src
COPY --from=build /app/packages/data-schemas/src ./packages/data-schemas/src
COPY --from=source /app/packages/database/scripts ./packages/database/scripts
COPY --from=source /app/packages/database/drizzle ./packages/database/drizzle
COPY --from=source /app/services/api/entrypoint.sh ./services/api/entrypoint.sh
RUN chmod +x ./services/api/entrypoint.sh

ENV DEV=production
EXPOSE 3001

ENTRYPOINT ["./services/api/entrypoint.sh"]
