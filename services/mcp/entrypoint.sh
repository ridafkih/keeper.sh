#!/bin/sh
set -e

export OTEL_SERVICE_NAME=keeper-mcp

exec keeper-otelemetry bun services/mcp/dist/index.js
