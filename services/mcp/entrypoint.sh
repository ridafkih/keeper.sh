#!/bin/sh
set -e

export OTEL_SERVICE_NAME=keeper-mcp

exec bun services/mcp/dist/index.js 2>&1 | keeper-otelemetry
