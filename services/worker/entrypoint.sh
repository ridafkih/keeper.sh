#!/bin/sh
set -e

export OTEL_SERVICE_NAME=keeper-worker

exec keeper-otelemetry bun services/worker/dist/index.js
