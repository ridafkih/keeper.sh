#!/bin/sh
set -e

exec bun dist/server-entry/index.js 2>&1 | keeper-otelemetry
