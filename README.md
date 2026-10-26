# ScaleTag

**A question. A place. Seven days.**

ScaleTag is a small, location-aware polling platform with an English interface. No accounts, no image storage, no map service, and no separate database server.

Development site: **https://scaletag.risinfo.cn**

## What it does

- Use the homepage for the introduction, and **`/create`** to create a poll with a title, plain-text description, up to three external HTTPS image URLs, 2–12 options, and an unverified signature.
- Require browser geolocation to publish. Store the coordinates with the poll without exposing exact coordinates in public API responses.
- Start immediately; accept a single choice for exactly **168 hours**.
- Display vote counts and percentages before and after voting. Refresh results every 15 seconds on visible poll pages.
- Generate a downloadable PNG QR code containing the canonical poll URL.
- List polls at **`/VoteList`**, newest first, with open/ended filters and an optional **100 km** radius filter. The homepage never lists polls.
- Permanently delete the poll, results, location, and related identifiers **30 days after publication**. The original page and QR endpoint then return 404. There is no recovery feature.

## Run locally

Requires Node.js 22+ (production uses Node.js 24 LTS).

```sh
npm ci --ignore-scripts
npm test
npm start
```

Visit http://127.0.0.1:3000. Loopback HTTP works for browser geolocation during local development. Production must use an HTTPS `PUBLIC_ORIGIN`; production cookies are Secure. Configuration is through environment variables; see `.env.example`. `.env` files are not automatically loaded.

```sh
PUBLIC_ORIGIN=https://polls.example.com DATA_DIR=/path/to/data NODE_ENV=production npm start
```

Native execution defaults to **127.0.0.1**. The container listens on `0.0.0.0` inside its network namespace, while Compose publishes **only `127.0.0.1:3000` on the host**. Cloudflare Tunnel remains the public entry point.

## Run in Docker

Requires Docker Engine 28+ and Docker Compose v2+.

```sh
cp .env.docker.example .env
# Edit PUBLIC_ORIGIN to your HTTPS hostname, then:
docker compose up --build --detach --wait
docker compose ps
docker compose logs --tail 30 app
```

Point your host's cloudflared tunnel to `http://127.0.0.1:3000`. There is no public HTTP port. Set `SCALETAG_PORT` if another local service already uses port 3000. Do not publish to `0.0.0.0` on the host; Docker-published ports can bypass UFW.

For loopback-only local development without an HTTPS proxy:

```sh
NODE_ENV=development PUBLIC_ORIGIN=http://127.0.0.1:3000 docker compose up --build --detach --wait
```

The image uses Node.js 24 Alpine, production-only dependencies, a non-root user, an HTTP health check and a file-based writer lock. Compose additionally sets a read-only root filesystem, drops Linux capabilities, limits memory to 256 MiB, disables core dumps and rotates startup/error logs. `.dockerignore` uses an allowlist so credentials, environment files and runtime data never enter image layers.

Poll JSON is stored in the **`poll-data` named volume**, mounted at `/data`. `docker compose down` preserves that volume. Rebuilding or recreating the app preserves poll contents, votes and deduplication records. **`docker compose down --volumes` permanently deletes the named-volume data.** Do not use it for routine upgrades.

To use an existing host directory, set `SCALETAG_DATA_SOURCE` to its absolute path and `SCALETAG_UID` / `SCALETAG_GID` to its numeric owner. Prepare a new directory with that ownership and mode `0700` before starting; the non-root container will not change its ownership for you. The default named volume uses UID/GID 1000.

Only one app instance may use a data directory. The entrypoint's `flock` prevents a second container or the native service from writing concurrently. Stop the existing service before migrating the same directory. Compose files and images contain no tunnel credentials.

## Storage and concurrency

[lowdb](https://github.com/typicode/lowdb) is the embedded JSON document store. Each poll lives in its own `<id>.json` file under `DATA_DIR`. An in-memory metadata index is rebuilt from files at startup; it is not a second retained copy. Voter identifiers are hashed and kept only for the voting period. No voter IPs, user agents, or browser fingerprints are stored.

Mutations to one poll run in a serialized queue. A vote's count and deduplication record are written together through lowdb's atomic temporary-file-and-rename adapter. **Only one application process may write a data directory.** Both the native systemd unit and the container entrypoint enforce this with `flock`. Do not run clustered Node workers, multiple containers, or manual second processes against the same directory.

Atomic rename prevents partial JSON writes; it is not a guarantee against all storage or power failures. This small-file design trades throughput for low operational cost and does not support multi-host deployments.

## Privacy and deletion

Each poll uses a different random cookie, scoped to that poll's API path, with `HttpOnly`, `Secure` in HTTPS mode, and `SameSite=Strict`. Its expiry is the poll's closing time. The server stores only its SHA-256 digest. Clearing cookies, changing browsers, or private browsing can bypass this protection: **one browser is not one verified person**.

Location filters use a POST body, so the querying coordinates are not added to URLs, and are discarded after the request. No analytics, third-party fonts, request access logs, or account system are included. Cloudflare and the host still process network information. External images load only when the viewer explicitly asks; their hosts may receive connection information.

Expired records are inaccessible at the exact deadline. A cleanup runs every 30 seconds and on startup to remove files and erase closed polls' deduplication hashes. Filesystem cleanup can be delayed if the VM is offline or storage fails. Do not enable VM snapshots, data backups, proxy caching, crash dumps, or external archival systems that would contradict the deletion promise. Existing infrastructure backups must be assessed by the operator. Deletion unlinks files; it is not forensic secure erasure of underlying storage sectors. Downloaded QR images and copies made by third parties cannot be recalled.

## Deployment on the development VM

```
Cloudflare HTTPS → cloudflared → 127.0.0.1:3000 → Docker → /ScaleTag/data/*.json
```

- `/ScaleTag/releases/<commit>/`: source releases and Docker build context.
- `/ScaleTag/current`: symlink to the running release.
- `/ScaleTag/data/`: runtime JSON documents, bind-mounted at `/data`; never copied into an image or release.
- `/etc/scaletag.env`: root-managed environment, including `PUBLIC_ORIGIN=https://scaletag.risinfo.cn`.
- `scaletag.service`: root-managed Docker lifecycle; the application inside the container runs with the numeric UID/GID of the `scaletag` user.
- `/usr/local/sbin/scaletag-container`: root-owned helper with fixed port, mount, non-root user and runtime restrictions.
- UFW: deny incoming by default; keep management SSH; no public 80/443/3000 rule.
- Cloudflare Tunnel `ScaleTag`: routes the hostname to the host's loopback port.

The VM uses the Docker CLI under a fixed systemd unit rather than giving the runner access to the Docker socket. The runner only needs its existing `sudo /usr/bin/systemctl restart scaletag.service` permission. `deploy/scaletag-container.service` and `deploy/scaletag-container.sh` are installed root-owned by the operator; configure the numeric `SCALETAG_UID` and `SCALETAG_GID` to match the data directory. The original `deploy/scaletag.service` remains available for native installations.

`deploy/deploy.sh` stages a release, switches the symlink and restarts the service. The root-managed helper builds a revision-tagged image and starts the container with `/ScaleTag/data` mounted directly. Failed restarts or host health checks restore the previous release. The previous native release remains usable for the initial migration rollback. Current and previous source releases are retained; no runtime data backup is created. Review old `scaletag:<commit>` images periodically and remove unused revisions explicitly; never prune unrelated images or volumes on a shared server.

GitHub Actions tests pull requests on GitHub-hosted Ubuntu, including a real Docker image build and isolated container persistence test. Deployment only runs on `main` using the self-hosted runner **eons**. The VM's Docker access stays restricted to the root-managed service. Protect `main` before accepting outside contributions.

## Initial operating cost

The existing VM, runner, and Cloudflare Tunnel are reused. The app introduces no separately billed database, image-storage service, maps API, or SaaS dependency. Existing VM, domain, Cloudflare plan, bandwidth and host backup charges still depend on the operator's plans.

Default safety limits: 20 creations/minute globally, 10,000 retained polls, 50,000 votes per poll, and a 256 MiB free-disk reserve before accepting writes. The global creation limit uses no IP identifier and is a resource guard, not a strong abuse-prevention system. Each vote rewrites that poll's JSON, so very popular polls need a different persistence design. Start small, measure latency, memory and disk use, and scale only when needed. The 256 MiB application/container limit is a ceiling, not measured consumption. Docker Engine and containerd add their own host overhead; measure them separately.

## Tests

```sh
npm run check
npm test
```

With Docker available, verify an already built image using an isolated named volume:

```sh
PUBLIC_ORIGIN=https://scaletag.test docker compose build
npm run test:container
```

The container test always uses its own project, local port and disposable volume. It checks startup, non-root execution, read-only root, memory configuration, loopback publishing, Secure cookies, QR generation, single-writer locking, graceful SIGTERM, and persisted vote counts/deduplication after container recreation. Only its isolated test volume is removed afterward.

Integration tests cover concurrent duplicate submissions, distinct votes, persisted counts across reload, exact 7/30-day boundaries, startup cleanup, 100 km boundaries, pagination, privacy, origin enforcement, size limits, and QR PNG downloads. Test files use isolated temporary directories.

## License

MIT. See [LICENSE](LICENSE).
