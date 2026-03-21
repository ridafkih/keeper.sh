#!/bin/sh
set -e

bun /app/packages/database/scripts/migrate.ts

exec bun services/api/dist/index.js 2>&1 | OTEL_SERVICE_NAME=keeper-api keeper-otelemetry
