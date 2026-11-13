#!/usr/bin/env bash
# Run from a trusted checkout on the deployment VM as the scaletag user.
set -euo pipefail
export PATH=/usr/local/bin:/usr/bin:/bin
root=/ScaleTag
[[ -f /etc/scaletag-ha/enabled ]] || {
  echo 'HA host bootstrap required; follow docs/ha-demo.md before deploying.' >&2
  exit 1
}
revision=${DEPLOY_REVISION:-${GITHUB_SHA:-$(git rev-parse HEAD)}}
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid revision' >&2; exit 1; }
image=${DEPLOY_IMAGE:-}
[[ "$image" =~ ^[a-z0-9]+([._-][a-z0-9]+)*/[a-z0-9]+([._-][a-z0-9]+)*:${revision}$ ]] || {
  echo "Invalid or missing DEPLOY_IMAGE '$image'; expected <namespace>/<repository>:$revision" >&2
  exit 1
}
mkdir -p "$root/releases" "$root/data"
exec 9>"$root/.deploy.lock"
flock -n 9 || { echo 'Another deployment is in progress' >&2; exit 1; }
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  docker pull "$image"
  docker tag "$image" "scaletag:$revision"
fi
release="$root/releases/$revision"
previous=$(readlink -f "$root/current" || true)
# Stage only the revision directory for /ScaleTag/current; never stage build
# inputs or run npm/docker build on the deployment host.
mkdir -p "$release"
ln -sfn "$release" "$root/.next"
mv -Tf "$root/.next" "$root/current"
healthy=false
if sudo /usr/bin/systemctl restart scaletag.service; then
  for attempt in {1..60}; do
    if curl --fail --silent http://127.0.0.1:3000/readyz | \
      python3 -c '
import json, sys
d = json.load(sys.stdin)
sys.exit(0 if d.get("instance") == "app1" and d.get("revision") == sys.argv[1] else 1)
' "$revision"; then healthy=true; break; fi
    sleep 1
  done
fi
if [[ "$healthy" != true ]]; then
  if [[ -n "$previous" && -d "$previous" ]]; then
    ln -sfn "$previous" "$root/.next"
    mv -Tf "$root/.next" "$root/current"
  fi
  echo 'HA rollout failed; helper handles slot rollback. Restored code symlink when available.' >&2
  exit 1
fi
# Retain revision directories separately; leave live data and daily backup archives untouched.
for old in "$root"/releases/*; do
  [[ -d "$old" && "$old" != "$release" && "$old" != "$previous" ]] || continue
  rm -rf -- "$old"
done
printf 'Deployed %s from %s\n' "$revision" "$image"
