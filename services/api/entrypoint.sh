#!/bin/sh
set -e

export OTEL_SERVICE_NAME=keeper-api

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  bun /app/packages/database/scripts/migrate.ts
fi

exec bun services/api/dist/index.js 2>&1 | keeper-otelemetry
