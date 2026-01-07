#!/bin/sh
set -e

bun /app/packages/database/scripts/migrate.ts
exec bun applications/api/dist/index.js
