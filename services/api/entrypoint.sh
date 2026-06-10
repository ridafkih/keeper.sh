#!/bin/sh
set -e

bun /app/packages/database/scripts/migrate.ts

exec bun services/api/dist/index.js 2>&1 | keeper-otelemetry
