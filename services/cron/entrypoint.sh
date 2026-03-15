#!/bin/sh
set -e

exec bun services/cron/dist/index.js
