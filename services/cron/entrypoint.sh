#!/bin/sh
set -e

export OTEL_SERVICE_NAME=keeper-cron

exec keeper-otelemetry bun services/cron/dist/index.js
