#!/bin/sh
set -e

cd /app/packages/database
bunx drizzle-kit migrate
cd /app
exec bun packages/api/dist/index.js
