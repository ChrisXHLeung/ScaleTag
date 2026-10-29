# HA demo verification — 2026-10-29 UTC

Scope: code and deployment pipeline for the single-host demonstration. The
existing public service and Cloudflare Tunnel were not changed. Integration
checks ran in a temporary, separate Docker Compose project on eons, using its
own random loopback port and disposable data volume. No public posts/votes were
created. Test projects, containers and volumes were removed afterward.

## Results

- Syntax checks and YAML parsing passed.
- 32 API/storage tests passed, including two independent Node processes writing
  the same SQLite database, counters/deduplication, shared limits, rollback,
  killed-writer recovery, expiry, readiness and explicit JSON migration.
- 13 backup tests passed, including consistent SQLite export into the original
  verified JSON archive format, stale-source handling, corruption rejection and
  90-day archive retention.
- Real Nginx primary/backup routing passed: app1 → app2 → app1, preserving poll
  totals, browser deduplication, tasks, replies and discovery across switches.
- Simultaneous writes from both containers produced the exact expected 21
  votes and one deduplicated like.
- The actual rollout helper replaced app2, switched ingress to it, replaced
  app1 and verified automatic failback. In one run, 314 GET samples during the
  update had zero errors and observed old app1, new app2, then new app1. A final run also
  started with app2 stopped, recovered that standby, and completed the rolling
  update with 306 error-free GET samples.
- Failed standby-image and failed primary-image updates both returned failure
  and exercised their rollback paths while retaining shared data.
- Ingress container identity stayed unchanged during app updates.
- Legacy single-container Docker regression passed, including writer locking,
  graceful shutdown and persisted votes/social data after recreation.

At the end of the small-data integration run, `docker stats --no-stream`
reported app1 **19.85 MiB**, app2 **19.87 MiB**, Nginx **2.285 MiB** (about
**42 MiB combined**). These are observations after a small test workload, not
peak measurements or production sizing guarantees, and exclude Docker,
cloudflared and host overhead. Configured memory ceilings remain 256 MiB per
app and 32 MiB for ingress.

## Limits and activation

Open-source Nginx detects failures passively; the request that discovers a
failure may fail. The sample result does not establish error-free delivery for
all failures, especially an in-flight POST. Sent writes are not automatically
replayed. Recovery reconsiders the primary after the five-second retry window.
This demonstrates application redundancy; ingress, disk and host remain shared
failure domains.

Browser UI suites are retained in CI. No UI code was changed in this work; this
report does not claim a new physical-device or full browser-suite run.

The live demonstration has now been activated on eons. Before the cutover, a
verified private archive was taken; all four existing documents matched their
SQLite imports by complete canonical-document SHA-256 fingerprints. Integrity
checks passed, the stale JSON sources were removed after validation, and a new
SQLite snapshot archive was verified. The systemd backup unit also completed
with `Result=success` and `ExecMainStatus=0`; its daily timer remains active.

Read-only checks through the actual HTTPS hostname observed app1 → app2 → app1
while stopping/restarting the primary. All four existing discovery records
remained present at each step. No synthetic public posts or votes were created.
The existing cloudflared tunnel was kept running and its origin port now belongs
to Nginx. Both apps have no published host port.

After those public checks, live `docker stats` reported app1 **19.93 MiB**, app2
**20.52 MiB** and Nginx **4.93 MiB** (about **45.4 MiB** combined, with the same
measurement limits described above).

A first import attempt stopped before reading data because source staged under
root's private umask was unreadable by the container UID. The recovery trap
restored the original service immediately. Public source permissions were
normalized, the image was rebuilt and checked as UID 1001, then migration
completed. Release staging and the documented bootstrap now normalize code
permissions; the root-managed rollout additionally checks non-root source
readability before replacing either slot. A regression creates an intentionally
unreadable image and asserts both serving container identities stay unchanged.

Initial activation commit `e3801d7` passed the complete GitHub Test workflow
(API/storage, browsers, backups, legacy Docker and HA Docker). The initial
automatic deployment correctly refused to run before the administrator bootstrap
marker existed. Subsequent deployments use the installed root-managed rolling
helper and exact-SHA CI gate. See [HA setup and migration](ha-demo.md).
