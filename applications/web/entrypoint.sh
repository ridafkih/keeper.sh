#!/bin/sh
set -e

export OTEL_SERVICE_NAME=keeper-web

exec keeper-otelemetry bun dist/server-entry/index.js
