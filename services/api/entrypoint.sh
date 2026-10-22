#!/bin/sh
set -e

export OTEL_SERVICE_NAME=keeper-api

if [ "${RUN_MIGRATIONS:-true}" != "false" ]; then
  bun /app/packages/database/scripts/migrate.ts
fi

exec keeper-otelemetry bun services/api/dist/index.js
