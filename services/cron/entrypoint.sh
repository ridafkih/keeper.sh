#!/bin/sh
set -e

export OTEL_SERVICE_NAME=keeper-cron

exec bun services/cron/dist/index.js 2>&1 | keeper-otelemetry
