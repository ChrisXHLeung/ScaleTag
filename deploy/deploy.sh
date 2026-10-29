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
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid revision'; exit 1; }
mkdir -p "$root/releases" "$root/data"
exec 9>"$root/.deploy.lock"
flock -n 9 || { echo 'Another deployment is in progress'; exit 1; }
release="$root/releases/$revision"
previous=$(readlink -f "$root/current" || true)
if [[ ! -d "$release" ]]; then
  stage=$(mktemp -d "$root/releases/.staging.XXXXXX")
  trap 'rm -rf "$stage"' EXIT
  cp -R src public deploy Dockerfile compose.yaml compose.ha.yaml .dockerignore package.json package-lock.json "$stage/"
  # Public code must remain readable by the image's non-root runtime even when
  # the runner or administrator stages it with a private umask.
  chmod -R u=rwX,go=rX "$stage"
  (cd "$stage" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund)
  mv "$stage" "$release"
  trap - EXIT
fi
ln -sfn "$release" "$root/.next"
mv -Tf "$root/.next" "$root/current"
healthy=false
if sudo /usr/bin/systemctl restart scaletag.service; then
  for attempt in {1..60}; do
    if curl --fail --silent http://127.0.0.1:3000/readyz | \
      node --input-type=module -e '
        let s="";for await(const c of process.stdin)s+=c;
        const d=JSON.parse(s);if(d.instance!=="app1"||d.revision!==process.argv[1])process.exit(1);
      ' "$revision"; then healthy=true; break; fi
    sleep 1
  done
fi
if [[ "$healthy" != true ]]; then
  if [[ -n "$previous" && -d "$previous" ]]; then
    ln -sfn "$previous" "$root/.next"
    mv -Tf "$root/.next" "$root/current"
  fi
  echo 'HA rollout failed; helper handles slot rollback. Restored code symlink when available.'
  exit 1
fi
# Retain code releases separately; leave live data and daily backup archives untouched.
for old in "$root"/releases/*; do
  [[ -d "$old" && "$old" != "$release" && "$old" != "$previous" ]] || continue
  rm -rf -- "$old"
done
printf 'Deployed %s\n' "$revision"
