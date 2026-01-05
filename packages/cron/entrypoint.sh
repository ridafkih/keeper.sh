#!/bin/sh
set -e

exec bun packages/cron/dist/index.js
