#!/bin/sh
set -e

if [ -n "$OTEL_EXPORTER_OTLP_ENDPOINT" ]; then
  exec bun dist/server-entry/index.js | bun ../../packages/log-transport/src/index.ts
else
  exec bun dist/server-entry/index.js
fi
