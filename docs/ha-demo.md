# Two-instance HA demonstration

This is a **single-host application failover demo**, not host/storage/ingress
redundancy. It deliberately uses only three containers and the existing tunnel:

```text
Cloudflare → existing host cloudflared → 127.0.0.1:3000
                                         Nginx ingress
                                       /               \
                              app1 (preferred)      app2 (backup)
                                       \               /
                                  shared /data/scaletag.sqlite
```

Only ingress publishes a loopback port. Neither app publishes a host port.
cloudflared's origin remains `http://127.0.0.1:3000`, now pointing to ingress.
If cloudflared runs in a container instead, join its network to ingress and use
`http://ingress:8080`; do not point the tunnel at either app slot. Tunnel tokens
are managed separately and never copied into this repository or app images.

## Resource choice

| Component | Configuration | Why |
| --- | --- | --- |
| Nginx | One worker, 256 connections, 8 upstream keepalives; 32 MiB memory limit | Built-in primary/backup upstream; no controller or monitoring daemon |
| Two Node apps | Existing 256 MiB memory limit per app | Needed to demonstrate replacement and failover |
| SQLite | Built into Node 24, 2 MiB page cache per connection | No separate database container, connection pool or database password |
| Storage | One local Docker volume/bind directory shared by both apps | Both slots immediately see committed data |

Limits are ceilings, not measured usage. Measure with `docker stats --no-stream`.
SQLite uses durable `DELETE` rollback journaling, `synchronous=FULL`, a 3-second
busy timeout and `BEGIN IMMEDIATE` around read-modify-write operations. Short
writes serialize across processes. This is appropriate for this small demo,
not a high-write-throughput service. No WAL tuning or additional database
process is necessary. Use a local filesystem, not NFS/SMB.

Votes and their deduplication hashes commit together; likes, replies, creation
limits and reply-rate limits also share transactions/storage across instances.
Discovery reads a fresh database snapshot, not a persistent per-process index.
The existing JSON backend remains available for legacy single-instance runs.

## Run an isolated demo

Requires Docker Engine 28+, Compose v2 and a Node 24 image. From the repository:

```sh
docker build --tag scaletag:local .
PUBLIC_ORIGIN=https://scaletag.test docker compose -f compose.ha.yaml up -d --wait
curl http://127.0.0.1:3000/readyz
# {"status":"ok","instance":"app1","revision":"local"}
```

Use the same `PUBLIC_ORIGIN` and Compose file for subsequent commands. To
publish from a browser, set `PUBLIC_ORIGIN` to the actual HTTPS tunnel hostname.
`/readyz` is read-only and reports the serving instance and code revision; no
database path, cookies, contacts or location are included.

```sh
PUBLIC_ORIGIN=https://scaletag.test docker compose -f compose.ha.yaml stop app1
curl http://127.0.0.1:3000/readyz  # app2
PUBLIC_ORIGIN=https://scaletag.test docker compose -f compose.ha.yaml start app1
# After startup and the 5-second passive retry window:
curl http://127.0.0.1:3000/readyz  # app1
```

Create a poll/task before stopping app1 and verify it, its votes/likes/replies
after each switch. Shared data survives replacement of either container.
`docker compose down` preserves data; **do not use `down --volumes`** on retained
demo data. That destructive option is used only by isolated automated tests.

## Failover semantics

The open-source Nginx upstream uses `app1 max_fails=1 fail_timeout=5s` and
`app2 backup`, with a shared upstream zone and Docker DNS `resolve` (requires
Nginx 1.27.3+, supplied by the stable image). Replacing a container does not
require restarting ingress. Ordinary updates do not recreate ingress.

This is **passive** failure detection: a real failed connection/request marks
app1 unavailable. After the retry window, a later request tests app1 again;
successful recovery returns preference to app1. It is not an active health-check
controller and does not guarantee instant or error-free recovery from every
failure. An app starts listening only after storage initialization. `/readyz`
checks database access; pipeline uses it before proceeding.

Safe GET requests may retry another upstream on connection errors/timeouts or
502/503/504. `non_idempotent` is deliberately absent: a POST already sent to an
app is not automatically replayed, because it may already have committed. An
in-flight write can therefore return an error during an unexpected crash;
failover is not a claim of exactly-once request delivery. A shared database
failure affects both instances and is outside this demonstration.

## Rolling pipeline

CI runs API/SQLite, browser, backup, legacy Docker and new HA integration tests.
Automatic deployment is triggered only after the complete `Test` workflow
succeeds for a push to `main`, and checks out that exact SHA. PR code never runs
on eons. An older SHA cannot deploy over a newer main. Manual dispatch still
runs syntax/API tests on the selected main SHA before rollout.

The existing restricted `sudo systemctl restart scaletag.service` permission
is reused. The runner does not receive Docker socket access or broad sudo.
One-time installation below changes that unit to a oneshot HA rollout service;
restarting it leaves running containers and ingress in place.

`deploy/ha-rollout.sh` (installed root-owned) serializes deployments and persists
each slot's image/revision in `/ScaleTag/ha/images.env`. It:

1. Builds the new app image while the current primary serves requests.
2. Verifies the primary before replacing the standby.
3. Replaces app2 only and waits for its database-backed readiness check.
4. Allows Nginx DNS to refresh, then gracefully stops app1 (15-second bound).
5. Verifies that requests through ingress reach app2 at the new revision.
6. Replaces app1 and verifies automatic ingress failback to the new app1.

If app2 fails readiness, the script restores its previous image and leaves
app1 serving. If app1 fails after cutover, it retains the updated app2 and
attempts to restore the previous app1. A failed rollback remains an explicit
deployment failure; it does not report success based on a surviving old image.
The outer deploy helper restores the code symlink on failure; slot images are
managed by the rollout helper, not by restarting the whole stack.

Schema changes during rolling updates must remain compatible with both
versions. This initial change only creates additive tables/indexes. Do not
automatically run destructive schema migrations or roll back shared data.

## One-time conversion of the existing VM

**The code commit does not perform this administrative conversion.** Before
enabling HA deployment, a host administrator must install the reviewed files,
archive/import existing data and replace the service unit. Until the marker
exists, deployment exits with a clear bootstrap-required error; it does not
silently restart the legacy app with a different storage backend.

These commands run as root from a reviewed, committed checkout of this change.
Choose the actual checkout path as `source_dir`. Keep the existing tunnel
running. The initial JSON-to-SQLite conversion has a short maintenance window;
subsequent updates use the rolling flow above.

```sh
source_dir=/path/to/reviewed/ScaleTag
revision=$(git -C "$source_dir" rev-parse HEAD)
release=/ScaleTag/releases/$revision
mkdir -p "$release" /etc/scaletag-ha/deploy /ScaleTag/ha
cp -R "$source_dir"/src "$source_dir"/public "$source_dir"/deploy \
  "$source_dir"/Dockerfile "$source_dir"/.dockerignore \
  "$source_dir"/compose.yaml "$source_dir"/compose.ha.yaml \
  "$source_dir"/package.json "$source_dir"/package-lock.json "$release/"
docker build --tag "scaletag:$revision" "$release"
install -m 0644 "$source_dir/compose.ha.yaml" /etc/scaletag-ha/compose.ha.yaml
install -m 0644 "$source_dir/deploy/nginx.conf" /etc/scaletag-ha/deploy/nginx.conf
install -m 0755 "$source_dir/deploy/ha-rollout.sh" /usr/local/sbin/scaletag-ha-rollout
install -m 0755 "$source_dir/deploy/backup.py" /usr/local/sbin/scaletag-backup

# Retain a private copy of the old unit and record the previous code symlink.
cp /etc/systemd/system/scaletag.service /ScaleTag/ha/legacy-scaletag.service
readlink -f /ScaleTag/current > /ScaleTag/ha/legacy-release
systemctl stop scaletag-backup.timer scaletag.service
# Create and verify a final archive after stopping the JSON writer.
/usr/local/sbin/scaletag-backup --data-dir /ScaleTag/data --backup-dir /ScaleTag/backups
app_uid=$(stat -c %u /ScaleTag/data)
app_gid=$(stat -c %g /ScaleTag/data)
# Import takes the legacy writer lock. JSON files are removed ONLY after the
# import commits; the verified private archive retains the recovery copy.
docker run --rm --user "$app_uid:$app_gid" --read-only \
  --cap-drop ALL --security-opt no-new-privileges:true \
  --env DATA_DIR=/data --mount type=bind,src=/ScaleTag/data,dst=/data \
  --entrypoint flock "scaletag:$revision" --nonblock /data/.writer.lock \
  node /app/src/migrate-sqlite.js --remove-source

ln -sfn "$release" /ScaleTag/current
install -m 0644 "$source_dir/deploy/scaletag-ha.service" /etc/systemd/system/scaletag.service
systemctl daemon-reload
systemctl enable scaletag.service
systemctl start scaletag.service
curl --fail http://127.0.0.1:3000/readyz
# Only after confirming app1 and both slots healthy:
touch /etc/scaletag-ha/enabled
systemctl start scaletag-backup.timer
```

Check every command; stop on an error. Do not start the legacy JSON writer
against SQLite data. For recovery, verify a private archive, restore its JSON
documents to a new empty private directory, and run the same explicit import
with both apps stopped. A nonempty SQLite store refuses a legacy merge. Keep
timestamps intact so restoring never extends public retention. The importer
can be rerun after successful import without overwriting live database rows.

The updated backup helper uses SQLite's online backup API to take a consistent
private snapshot, then exports the same verified JSON archive format and
90-day retention as before. It ignores stale JSON if SQLite exists and fails
on an invalid database rather than archiving stale data. In rollback-journal
mode a snapshot may briefly contend with writes. Do not back up SQLite with a
plain file copy while instances are running. The existing backup timer and
root-only archive permissions remain in use.

## Automated verification

```sh
npm test
python3 -m unittest discover -s test -p '*_test.py' -v
docker build --tag scaletag:ha-test .
npm run test:ha
```

The HA test creates its own project/volume/loopback port, verifies real Nginx
failover and failback, performs writes from both containers, checks deduplication
and contacts after switching, exercises the actual rollout helper under GET
traffic, and injects failed standby/primary images to check rollback. It checks
that ingress stays running and prints container memory usage. Only its own
temporary resources are removed; it never creates public demo posts or touches
the existing tunnel or live data.

References: [Nginx upstream](https://nginx.org/en/docs/http/ngx_http_upstream_module.html),
[retry semantics](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_next_upstream),
[SQLite locking](https://sqlite.org/lockingv3.html).
