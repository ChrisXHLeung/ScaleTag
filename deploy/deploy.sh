#!/usr/bin/env bash
# Root production HA deployment script executed on target runners via sudo from GitHub Actions.
set -euo pipefail
exec </dev/null

if [[ $(id -u) -eq 0 ]]; then
  test_mode=0
  export PATH=/usr/local/bin:/usr/bin:/bin
  lock_file=/run/lock/scaletag-pipeline.lock
  release_dir=/ScaleTag/release
  env_file=/etc/scaletag-fresh/scaletag.env
  repo=https://github.com/ChrisXHLeung/ScaleTag.git
  rollout_sleep=2
  poll_sleep_ingress=1
  poll_sleep_slot=2
  ingress_attempts=20
  slot_attempts=60
elif [[ "${SCALETAG_DEPLOY_TEST_MODE:-}" == "1" ]]; then
  test_mode=1
  export PATH="${SCALETAG_TEST_PATH:+${SCALETAG_TEST_PATH}:}/usr/local/bin:/usr/bin:/bin"
  lock_file=${SCALETAG_TEST_LOCK_FILE:?SCALETAG_TEST_LOCK_FILE required in test mode}
  release_dir=${SCALETAG_TEST_RELEASE_DIR:?SCALETAG_TEST_RELEASE_DIR required in test mode}
  env_file=${SCALETAG_TEST_ENV_FILE:?SCALETAG_TEST_ENV_FILE required in test mode}
  repo=${SCALETAG_TEST_REPO:-https://github.com/ChrisXHLeung/ScaleTag.git}
  rollout_sleep=${SCALETAG_TEST_SLEEP_SECONDS:-0}
  poll_sleep_ingress=${SCALETAG_TEST_POLL_SLEEP:-0}
  poll_sleep_slot=${SCALETAG_TEST_POLL_SLEEP:-0}
  ingress_attempts=3
  slot_attempts=3
else
  echo 'Root required' >&2
  exit 1
fi

mkdir -p -- "$(dirname -- "$lock_file")"
exec 9>"$lock_file"
flock -w 300 9 || { echo 'Timed out waiting for another deployment to finish' >&2; exit 1; }

revision=${1:-${DEPLOY_REVISION:-}}
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid or missing deployment revision' >&2; exit 1; }

image=${2:-${DEPLOY_IMAGE:-}}
[[ "$image" =~ ^[a-z0-9]+([._-][a-z0-9]+)*/[a-z0-9]+([._-][a-z0-9]+)*:${revision}$ ]] || {
  echo "Invalid or missing deployment image '$image'; expected <namespace>/<repository>:$revision" >&2
  exit 1
}

public_origin=${3:-${DEPLOY_PUBLIC_ORIGIN:-https://jp.scaletag.top}}
[[ "$public_origin" =~ ^https://[^[:space:]]+$ ]] || {
  echo "Invalid public origin '$public_origin'; expected https://..." >&2
  exit 1
}

remote_main=$(git ls-remote "$repo" refs/heads/main | cut -f1)
[[ "$remote_main" =~ ^[0-9a-f]{40}$ ]] || { echo 'Cannot resolve remote main' >&2; exit 1; }
if [[ "$remote_main" != "$revision" ]]; then
  echo "Stale deployment rejected: target revision $revision does not match remote main $remote_main" >&2
  exit 1
fi

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
repo_root=$(cd -- "$script_dir/.." && pwd -P)
src_compose="$repo_root/compose.ha.yaml"
src_nginx="$repo_root/deploy/nginx.conf"
[[ -f "$src_compose" && -f "$src_nginx" ]] || {
  echo "Missing source HA templates ($src_compose or $src_nginx)" >&2
  exit 1
}

compose_file="$release_dir/compose.ha.yaml"
dst_nginx="$release_dir/deploy/nginx.conf"
install -d -m 0755 "$release_dir" "$release_dir/deploy"

sync_config_file() {
  local src="$1" dst="$2"
  if [[ -e "$dst" ]]; then
    if [[ "$src" -ef "$dst" ]] || cmp -s "$src" "$dst"; then
      chmod 0644 "$dst"
      return 0
    fi
  fi
  install -m 0644 "$src" "$dst"
}

sync_config_file "$src_compose" "$compose_file"
sync_config_file "$src_nginx" "$dst_nginx"

env_dir=$(dirname -- "$env_file")
tmp_env=""
cleanup_tmp_env() {
  if [[ -n "${tmp_env:-}" && -e "$tmp_env" ]]; then
    rm -f -- "$tmp_env"
  fi
}

if [[ ! -e "$env_file" ]]; then
  if [[ "$test_mode" -eq 0 ]]; then
    install -d -m 0700 -o 0 -g 0 "$env_dir"
  else
    install -d -m 0700 "$env_dir"
  fi

  if command -v openssl >/dev/null 2>&1; then
    encryption_key=$(openssl rand -hex 32)
  else
    encryption_key=$(python3 -c 'import secrets; print(secrets.token_hex(32))')
  fi
  [[ "$encryption_key" =~ ^[0-9a-f]{64}$ ]] || {
    echo 'Failed to generate valid 256-bit encryption key' >&2
    exit 1
  }

  trap cleanup_tmp_env EXIT
  tmp_env=$(umask 077 && mktemp "$env_dir/.scaletag.env.XXXXXX")
  printf 'PUBLIC_ORIGIN=%s\nSCALETAG_PORT=3000\nSCALETAG_ENCRYPTION_KEY=%s\nSCALETAG_UID=1000\nSCALETAG_GID=1000\n' \
    "$public_origin" "$encryption_key" > "$tmp_env"
  chmod 0600 "$tmp_env"
  if [[ "$test_mode" -eq 0 ]]; then
    chown 0:0 "$tmp_env"
  fi
  if [[ -e "$env_file" ]]; then
    rm -f -- "$tmp_env"
  else
    mv -n -- "$tmp_env" "$env_file"
  fi
  tmp_env=""
  trap - EXIT
  echo "Created initial environment file $env_file for $public_origin"
fi

[[ -f "$env_file" ]] || {
  echo "Environment file path is not a regular file: $env_file" >&2
  exit 1
}

cd "$release_dir"

ingress_port=$(sed -n 's/^SCALETAG_PORT=\([0-9][0-9]*\)$/\1/p' "$env_file" | tail -n 1 || true)
ingress_port=${ingress_port:-3000}

compose() {
  docker compose -p scaletag-ha --env-file "$env_file" -f "$compose_file" "$@"
}

check() {
  curl -fsS --max-time 5 "http://127.0.0.1:${ingress_port}/readyz" | python3 -c '
import json, sys
d = json.load(sys.stdin)
sys.exit(0 if d.get("status") == "ok" and d.get("revision") == sys.argv[1] else 1)
' "$1"
}

wait_ingress() {
  local rev="$1" i
  for ((i=1; i<=ingress_attempts; i++)); do
    if check "$rev" >/dev/null 2>&1; then
      return 0
    fi
    sleep "$poll_sleep_ingress"
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
  local slot="$1" rev="$2" i
  for ((i=1; i<=slot_attempts; i++)); do
    if slot_check "$slot" "$rev"; then
      return 0
    fi
    sleep "$poll_sleep_slot"
  done
  return 1
}

pull_and_tag_image() {
  # Pull exact prebuilt SHA image; never build on the server.
  echo "Pulling prebuilt image $image"
  docker pull -q "$image"
  docker image inspect "$image" >/dev/null
  docker tag "$image" "scaletag:$revision"
}

run_backup_if_installed() {
  local units=""
  if command -v systemctl >/dev/null 2>&1; then
    units=$(systemctl list-unit-files scaletag-backup.service 2>/dev/null || true)
  fi
  if [[ "$units" =~ (^|[[:space:]])scaletag-backup\.service([[:space:]]|$) ]]; then
    echo 'Running pre-deployment backup'
    systemctl start scaletag-backup.service
  else
    echo 'Skipping pre-deployment backup (scaletag-backup.service not installed)'
  fi
}

app1=$(docker ps -q --filter label=com.docker.compose.project=scaletag-ha --filter label=com.docker.compose.service=app1)
app2=$(docker ps -q --filter label=com.docker.compose.project=scaletag-ha --filter label=com.docker.compose.service=app2)

if [[ -z "$app1" || -z "$app2" ]]; then
  pull_and_tag_image
  run_backup_if_installed

  export APP1_IMAGE="scaletag:$revision" APP2_IMAGE="scaletag:$revision" APP1_REVISION="$revision" APP2_REVISION="$revision"
  if compose up -d && wait_slot app1 "$revision" && wait_slot app2 "$revision" && wait_ingress "$revision"; then
    echo "Bootstrapped and deployed $revision from $image"
    exit 0
  fi

  echo 'Bootstrap deployment health check failed' >&2
  compose ps -a >&2 || true
  exit 1
fi

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

pull_and_tag_image
run_backup_if_installed

export APP1_IMAGE="scaletag:$revision" APP2_IMAGE="scaletag:$revision" APP1_REVISION="$revision" APP2_REVISION="$revision"
if compose up -d --no-deps app2 >/dev/null && wait_slot app2 "$revision" && sleep "$rollout_sleep" && compose up -d --no-deps app1 >/dev/null && wait_slot app1 "$revision" && wait_ingress "$revision"; then
  echo "Deployed $revision from $image"
  exit 0
fi

echo 'Deployment failed; restoring previous images; data backup retained' >&2
export APP1_IMAGE="$old1" APP2_IMAGE="$old2" APP1_REVISION="$old_revision" APP2_REVISION="$old_revision2"
if compose up -d --no-deps app2 >/dev/null && wait_slot app2 "$old_revision2" && sleep "$rollout_sleep" && compose up -d --no-deps app1 >/dev/null && wait_slot app1 "$old_revision" && wait_ingress "$old_revision"; then
  echo 'Previous images restored; database migrations may require manual recovery' >&2
  exit 1
fi

echo 'Rollback health check failed' >&2
exit 1
