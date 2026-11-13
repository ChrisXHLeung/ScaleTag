#!/usr/bin/env bash
# Root production HA deployment script executed on ocihost via sudo from GitHub Actions.
set -euo pipefail
export PATH=/usr/local/bin:/usr/bin:/bin
exec </dev/null

[[ $(id -u) -eq 0 ]] || { echo 'Root required' >&2; exit 1; }

exec 9>/run/lock/scaletag-pipeline.lock
flock -n 9 || { echo 'Another deployment is already running' >&2; exit 1; }

revision=${1:-${DEPLOY_REVISION:-}}
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid or missing deployment revision' >&2; exit 1; }

image=${2:-${DEPLOY_IMAGE:-}}
[[ "$image" =~ ^[a-z0-9]+([._-][a-z0-9]+)*/[a-z0-9]+([._-][a-z0-9]+)*:${revision}$ ]] || {
  echo "Invalid or missing deployment image '$image'; expected <namespace>/<repository>:$revision" >&2
  exit 1
}

repo=https://github.com/ChrisXHLeung/ScaleTag.git
remote_main=$(git ls-remote "$repo" refs/heads/main | cut -f1)
[[ "$remote_main" =~ ^[0-9a-f]{40}$ ]] || { echo 'Cannot resolve remote main' >&2; exit 1; }
if [[ "$remote_main" != "$revision" ]]; then
  echo "Stale deployment rejected: target revision $revision does not match remote main $remote_main" >&2
  exit 1
fi

release_dir=/ScaleTag/release
compose_file="$release_dir/compose.ha.yaml"
env_file=/etc/scaletag-fresh/scaletag.env
[[ -d "$release_dir" && -f "$compose_file" && -f "$env_file" ]] || {
  echo "Missing production HA configuration ($compose_file or $env_file)" >&2
  exit 1
}
cd "$release_dir"

compose() {
  docker compose -p scaletag-ha --env-file "$env_file" -f "$compose_file" "$@"
}

check() {
  curl -fsS --max-time 5 http://127.0.0.1:3000/readyz | python3 -c '
import json, sys
d = json.load(sys.stdin)
sys.exit(0 if d.get("status") == "ok" and d.get("revision") == sys.argv[1] else 1)
' "$1"
}

wait_ingress() {
  local rev="$1"
  for _ in {1..10}; do
    if check "$rev" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

slot_check() {
  local slot="$1" expected="$2" id
  id=$(docker ps -q --filter label=com.docker.compose.project=scaletag-ha --filter "label=com.docker.compose.service=$slot")
  [[ -n "$id" ]] || return 1
  docker exec "$id" node --input-type=module -e '
const r = await fetch("http://127.0.0.1:3000/readyz");
const d = await r.json();
process.exit(r.ok && d.status === "ok" && d.instance === process.argv[2] && d.revision === process.argv[1] ? 0 : 1);
' "$expected" "$slot" >/dev/null 2>&1
}

wait_slot() {
  local slot="$1" rev="$2"
  for _ in {1..60}; do
    if slot_check "$slot" "$rev"; then
      return 0
    fi
    sleep 2
  done
  return 1
}

app1=$(docker ps -q --filter label=com.docker.compose.project=scaletag-ha --filter label=com.docker.compose.service=app1)
app2=$(docker ps -q --filter label=com.docker.compose.project=scaletag-ha --filter label=com.docker.compose.service=app2)
[[ -n "$app1" && -n "$app2" ]] || { echo 'Application slots not running' >&2; exit 1; }

old_revision=$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$app1" | sed -n 's/^APP_REVISION=//p')
[[ "$old_revision" =~ ^[0-9a-f]{40}$ ]] || { echo 'Current app1 revision unknown' >&2; exit 1; }

old_revision2=$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$app2" | sed -n 's/^APP_REVISION=//p')
[[ "$old_revision2" =~ ^[0-9a-f]{40}$ ]] || { echo 'Current app2 revision unknown' >&2; exit 1; }

if [[ "$revision" == "$old_revision" && "$revision" == "$old_revision2" ]]; then
  wait_ingress "$revision" || { echo "Slots report $revision but ingress readiness check failed" >&2; exit 1; }
  echo "Already deployed $revision"
  exit 0
fi

old1=$(docker inspect --format '{{.Image}}' "$app1")
old2=$(docker inspect --format '{{.Image}}' "$app2")
[[ -n "$old1" && -n "$old2" ]] || { echo 'Current slot images unknown' >&2; exit 1; }

# Pull exact prebuilt SHA image; never build on the server.
echo "Pulling prebuilt image $image"
docker pull -q "$image"
docker image inspect "$image" >/dev/null
docker tag "$image" "scaletag:$revision"

echo 'Running pre-deployment backup'
systemctl start scaletag-backup.service

export APP1_IMAGE="scaletag:$revision" APP2_IMAGE="scaletag:$revision" APP1_REVISION="$revision" APP2_REVISION="$revision"
if compose up -d --no-deps app2 >/dev/null && wait_slot app2 "$revision" && sleep 2 && compose up -d --no-deps app1 >/dev/null && wait_slot app1 "$revision" && wait_ingress "$revision"; then
  echo "Deployed $revision from $image"
  exit 0
fi

echo 'Deployment failed; restoring previous images; data backup retained' >&2
export APP1_IMAGE="$old1" APP2_IMAGE="$old2" APP1_REVISION="$old_revision" APP2_REVISION="$old_revision2"
if compose up -d --no-deps app2 >/dev/null && wait_slot app2 "$old_revision2" && sleep 2 && compose up -d --no-deps app1 >/dev/null && wait_slot app1 "$old_revision" && wait_ingress "$old_revision"; then
  echo 'Previous images restored; database migrations may require manual recovery' >&2
  exit 1
fi

echo 'Rollback health check failed' >&2
exit 1
