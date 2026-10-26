#!/bin/sh
set -eu
umask 077
: "${DATA_DIR:=/data}"
mkdir -p "$DATA_DIR"
# The same lock path is used by native and container deployments.
exec flock --no-fork --nonblock "$DATA_DIR/.writer.lock" "$@"
