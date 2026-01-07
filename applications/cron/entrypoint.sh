#!/bin/sh
set -e

exec bun applications/cron/dist/index.js
