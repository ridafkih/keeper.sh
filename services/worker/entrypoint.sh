#!/bin/sh
set -e

export OTEL_SERVICE_NAME=keeper-worker

exec bun services/worker/dist/index.js 2>&1 | keeper-otelemetry
