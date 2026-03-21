#!/bin/sh
set -e

exec bun services/mcp/dist/index.js 2>&1 | OTEL_SERVICE_NAME=keeper-mcp keeper-otelemetry
