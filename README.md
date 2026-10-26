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

The application **always binds to 127.0.0.1**. Put it behind a Cloudflare Tunnel or another local reverse proxy.

## Storage and concurrency

[lowdb](https://github.com/typicode/lowdb) is the embedded JSON document store. Each poll lives in its own `<id>.json` file under `DATA_DIR`. An in-memory metadata index is rebuilt from files at startup; it is not a second retained copy. Voter identifiers are hashed and kept only for the voting period. No voter IPs, user agents, or browser fingerprints are stored.

Mutations to one poll run in a serialized queue. A vote's count and deduplication record are written together through lowdb's atomic temporary-file-and-rename adapter. **Only one application process may write a data directory.** The production systemd unit enforces this with `flock`. Do not run clustered Node workers, multiple containers, or manual second processes against the same directory.

Atomic rename prevents partial JSON writes; it is not a guarantee against all storage or power failures. This small-file design trades throughput for low operational cost and does not support multi-host deployments.

## Privacy and deletion

Each poll uses a different random cookie, scoped to that poll's API path, with `HttpOnly`, `Secure` in HTTPS mode, and `SameSite=Strict`. Its expiry is the poll's closing time. The server stores only its SHA-256 digest. Clearing cookies, changing browsers, or private browsing can bypass this protection: **one browser is not one verified person**.

Location filters use a POST body, so the querying coordinates are not added to URLs, and are discarded after the request. No analytics, third-party fonts, request access logs, or account system are included. Cloudflare and the host still process network information. External images load only when the viewer explicitly asks; their hosts may receive connection information.

Expired records are inaccessible at the exact deadline. A cleanup runs every 30 seconds and on startup to remove files and erase closed polls' deduplication hashes. Filesystem cleanup can be delayed if the VM is offline or storage fails. Do not enable VM snapshots, data backups, proxy caching, crash dumps, or external archival systems that would contradict the deletion promise. Existing infrastructure backups must be assessed by the operator. Deletion unlinks files; it is not forensic secure erasure of underlying storage sectors. Downloaded QR images and copies made by third parties cannot be recalled.

## Deployment on the development VM

```
Cloudflare HTTPS → cloudflared → 127.0.0.1:3000 → /ScaleTag/data/*.json
```

- `/ScaleTag/releases/<commit>/`: application releases and dependencies.
- `/ScaleTag/current`: symlink to the running release.
- `/ScaleTag/data/`: runtime JSON documents; never committed or bundled with releases.
- `/etc/scaletag.env`: environment configuration.
- `scaletag.service`: non-root process, 256 MiB memory ceiling, one writer.
- UFW: deny incoming by default; keep management SSH; no public 80/443/3000 rule.
- Cloudflare Tunnel `ScaleTag` routes the development hostname to the loopback app.

Install Node.js 24 LTS, provision the data directory for the `scaletag` user, install `deploy/scaletag.service`, and set `/etc/scaletag.env`:

```ini
PUBLIC_ORIGIN=https://scaletag.risinfo.cn
```

The trusted runner user needs permission to execute only `sudo /usr/bin/systemctl restart scaletag.service` without a password. `deploy/deploy.sh` installs locked dependencies in a new release, switches the symlink, restarts, checks health, and rolls back on failure. It preserves the current and previous code releases, **never copies runtime data**.

GitHub Actions tests pull requests on GitHub-hosted Ubuntu. Deployment only runs on `main` using the self-hosted runner **eons**; a runner-name guard rejects execution on any other matching runner. Never execute untrusted pull requests on the VM. Protect `main` before accepting outside contributions.

## Initial operating cost

The existing VM, runner, and Cloudflare Tunnel are reused. The app introduces no separately billed database, image-storage service, maps API, or SaaS dependency. Existing VM, domain, Cloudflare plan, bandwidth and host backup charges still depend on the operator's plans.

Default safety limits: 20 creations/minute globally, 10,000 retained polls, 50,000 votes per poll, and a 256 MiB free-disk reserve before accepting writes. The global creation limit uses no IP identifier and is a resource guard, not a strong abuse-prevention system. Each vote rewrites that poll's JSON, so very popular polls need a different persistence design. Start small, measure latency, memory and disk use, and scale only when needed. The 256 MiB service limit is a ceiling, not measured consumption.

## Tests

```sh
npm run check
npm test
```

Integration tests cover concurrent duplicate submissions, distinct votes, persisted counts across reload, exact 7/30-day boundaries, startup cleanup, 100 km boundaries, pagination, privacy, origin enforcement, size limits, and QR PNG downloads. Test files use isolated temporary directories.

## License

MIT. See [LICENSE](LICENSE).
