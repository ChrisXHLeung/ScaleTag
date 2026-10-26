#!/bin/sh
# Install root-owned at /usr/local/sbin/scaletag-container.
# The runner may restart the fixed service, not access the Docker socket.
set -eu
release=$(readlink -f /ScaleTag/current)
revision=${release##*/}
case "$revision" in *[!0-9a-f]*|'') echo 'Invalid release revision' >&2; exit 1;; esac
[ "${#revision}" -eq 40 ] && [ "$release" = "/ScaleTag/releases/$revision" ] || exit 1
uid=${SCALETAG_UID:-1000}
gid=${SCALETAG_GID:-1000}
case "$uid:$gid" in *[!0-9:]*|:*|*:) exit 1;; esac
[ "$uid" -gt 0 ] && [ "$gid" -gt 0 ] || { echo 'A non-root application user is required' >&2; exit 1; }
image="scaletag:$revision"
case "${1:-}" in
  build)
    # Keep the previous native release runnable during the initial migration rollback.
    [ -f "$release/Dockerfile" ] || exit 0
    mkdir -p "${DOCKER_CONFIG:-/var/lib/scaletag/docker-config}"
    docker image inspect "$image" >/dev/null 2>&1 || docker build --tag "$image" "$release"
    ;;
  run)
    if [ ! -f "$release/Dockerfile" ]; then
      exec /usr/sbin/runuser -u scaletag -- /usr/bin/flock --no-fork --nonblock \
        /ScaleTag/data/.writer.lock /usr/local/bin/node "$release/src/server.js"
    fi
    exec docker run --rm --name scaletag-app --init \
      --user "$uid:$gid" --read-only --cap-drop ALL \
      --security-opt no-new-privileges:true --pids-limit 64 \
      --memory 256m --memory-swap 256m --ulimit core=0 \
      --tmpfs /tmp:rw,nosuid,nodev,size=16m,mode=1777 \
      --log-driver local --log-opt max-size=5m --log-opt max-file=2 \
      --env-file /etc/scaletag.env \
      --env NODE_ENV=production --env HOST=0.0.0.0 --env PORT=3000 --env DATA_DIR=/data \
      --publish 127.0.0.1:3000:3000 \
      --mount type=bind,source=/ScaleTag/data,target=/data \
      "$image"
    ;;
  stop)
    if docker container inspect scaletag-app >/dev/null 2>&1; then
      docker stop --time 15 scaletag-app
    fi
    ;;
  *) echo 'Usage: scaletag-container build|run|stop' >&2; exit 1;;
esac
