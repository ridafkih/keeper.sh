#!/bin/sh
set -e

bun /app/packages/database/scripts/migrate.ts

if [ -n "$OTEL_EXPORTER_OTLP_ENDPOINT" ]; then
  exec bun services/api/dist/index.js | bun packages/log-transport/src/index.ts
else
  exec bun services/api/dist/index.js
fi
