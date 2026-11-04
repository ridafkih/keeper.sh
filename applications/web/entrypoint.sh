#!/bin/sh
set -e

exec keeper-otelemetry bun dist/server-entry/index.js
