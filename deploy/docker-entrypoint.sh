#!/bin/sh
set -eu
umask 077
: "${DATA_DIR:=/data}"
mkdir -p "$DATA_DIR"
if [ "${STORAGE_BACKEND:-json}" = sqlite ]; then
  # SQLite owns the cross-process transaction locks; do not hold the legacy
  # lifetime writer lock, which would exclude the standby instance.
  exec "$@"
fi
# The same lock path is used by native and container deployments.
exec flock --no-fork --nonblock "$DATA_DIR/.writer.lock" "$@"
