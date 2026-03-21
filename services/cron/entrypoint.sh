#!/bin/sh
set -e

exec bun services/cron/dist/index.js 2>&1 | keeper-otelemetry
