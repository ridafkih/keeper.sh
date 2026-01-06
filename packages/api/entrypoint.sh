#!/bin/sh
set -e

bun /app/packages/database/scripts/migrate.ts
exec bun packages/api/dist/index.js
