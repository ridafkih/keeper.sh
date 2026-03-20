#!/bin/sh
set -e

if [ -n "$OTEL_EXPORTER_OTLP_ENDPOINT" ]; then
  exec bun services/mcp/dist/index.js | bun packages/log-transport/src/index.ts
else
  exec bun services/mcp/dist/index.js
fi
