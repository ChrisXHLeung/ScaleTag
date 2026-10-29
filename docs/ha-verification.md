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

The code has not converted the live service. Initial activation requires the
documented root-managed helper/unit installation and a verified offline import
of existing JSON into SQLite. See [HA setup and migration](ha-demo.md). Until
the administrator bootstrap marker exists, deployment fails safely before
switching the existing code symlink or restarting the old service.
