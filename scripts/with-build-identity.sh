#!/bin/sh
set -e

COMMIT_SHA="$(git rev-parse HEAD)"
VERSION="$(git describe --tags --always --dirty | sed 's/^v//')"
export COMMIT_SHA VERSION

exec "$@"
