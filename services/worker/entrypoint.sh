#!/bin/sh
set -e

exec bun services/worker/dist/index.js
