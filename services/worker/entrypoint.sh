#!/bin/sh
set -e

exec bun services/worker/dist/index.js 2>&1 | keeper-otelemetry
