#!/bin/sh
set -e

exec bun services/mcp/dist/index.js
