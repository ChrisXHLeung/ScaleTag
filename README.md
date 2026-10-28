# ScaleTag

**A question. A place. Seven days.**

ScaleTag is a small, location-aware polling platform with an English interface. No accounts, no image storage, no self-hosted map server, and no separate database server.

Development site: **https://scaletag.risinfo.cn**

## What it does

- Use the homepage for the introduction, and **`/create`** to create a poll with a title, plain-text description, up to three external HTTPS image URLs, 2–12 options, and an unverified signature.
- Require browser geolocation to publish. Store the coordinates with the poll without exposing exact coordinates in public API responses; publish only rounded map positions after explicit consent.
- Start immediately; accept a single choice for exactly **168 hours**.
- Display vote counts and percentages before and after voting. Refresh results every 15 seconds on visible poll pages.
- Generate a downloadable PNG QR code containing the canonical poll URL.
- List polls at **`/VoteList`**, newest first, with open/ended filters and an optional **100 km** radius filter. Switch between List and Map; the homepage never lists polls.
- Remove the poll, results, location, and related identifiers from active storage **30 days after publication**. The original page and QR endpoint then return 404. Private daily archives are retained for **90 days after backup creation** for administrator-managed recovery.

## Pages

| Path        | Purpose                                                                             |
| ----------- | ----------------------------------------------------------------------------------- |
| `/`         | Introduction and QR code for installing the app; no poll listing.                   |
| `/create`   | Publish a single-choice poll with required GPS permission.                          |
| `/VoteList` | Browse retained polls in List or Map view, with status and optional 100 km filters. |
| `/install`  | Device-specific PWA installation guide.                                             |
| `/privacy`  | Explain cookies, location, deletion and private backup retention.                   |

Each published poll also has its own shareable URL and downloadable QR code. Installing the app does not create an account or change the anonymous voting rules.

## Map view

VoteList opens in **List** view. Choosing **Map** loads [MapLibre GL JS](https://maplibre.org/) 6.16.0 from ScaleTag and the Positron basemap from [OpenFreeMap](https://openfreemap.org/). There is no map API key, registration, separate map server or additional paid service. OpenFreeMap currently offers free public map hosting, including commercial use, without map-view quotas; it provides no SLA. Keep the OpenMapTiles/OpenStreetMap attribution visible. Map availability depends on the provider and the visitor's network/browser; List remains available independently.

- Open polls use blue dots; ended polls use red dots. Numbered groups expand on click. Select a dot to open a poll; polls sharing a rounded position appear together in the popup.
- Status and optional 100 km filters apply to both views. Nearby matching uses the original GPS on the server; the requesting visitor's coordinates are discarded after the search.
- The map shows only polls created with explicit map consent (`mapVisible: true`). The creation form requires acknowledgement before publishing. Existing polls and API clients without this flag remain list-only; they are not retroactively exposed.
- Public markers use a stable **0.01° latitude/longitude grid**, roughly 1.1 km north–south and narrower east–west. Exact GPS stays in the private JSON store. A rounded position is an approximate area, not an anonymity guarantee; an original coordinate already on the grid is unchanged.
- At most the **newest 1,000 matching mapped polls** are returned. The interface shows the returned and total counts; use filters to narrow large sets. A text list of mapped polls is available below the map for keyboard and assistive-technology access.
- Marker searches use `POST /api/map/search` and `no-store`. No coordinates are put in URLs. Current markers refresh at most every 30 seconds and at upcoming closing/deletion boundaries while the page is visible. Failed refreshes and offline mode clear markers rather than presenting retained results as current.

Choosing Map sends the visitor's IP address and requested map areas to OpenFreeMap. Poll titles, signatures and votes are not sent to the map provider. The MapLibre module, CSS and worker are served locally from a pinned dependency; the map connects only to `tiles.openfreemap.org`. Third-party map resources, marker responses and map-library files are excluded from the PWA cache. The browser may cache basemap resources under the provider's own headers; ScaleTag does not download offline map areas. MapLibre uses WebGL, with List as the fallback on unsupported devices.

```sh
npx playwright install --with-deps chromium
npm run test:map
```

Map regression tests run real MapLibre in Chromium with a deterministic mocked basemap, isolated poll data, marker interactions, filters, offline/error handling, expiry, consent, text escaping and mobile layout. External basemap availability is checked separately against the development site.

## Install as a PWA

ScaleTag is an installable web app served over HTTPS. Open the homepage on a computer, scan its QR code with your phone, and follow the installation guide at **`/install`**. You can also open the guide directly on your phone or use **Install app** in the footer.

| Device / browser                                       | Installation flow                                                                                              |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Android with a supported browser offering installation | Tap **Install ScaleTag**, then confirm the browser's installation prompt.                                      |
| Android without an available installation prompt       | Follow the guide to install or add the app from the browser menu.                                              |
| iPhone / iPad                                          | Open in Safari, tap **Share → Add to Home Screen**, then confirm **Add**. Enable **Open as Web App** if shown. |
| Desktop                                                | Use **Install ScaleTag** when offered, or follow the browser's installation menu.                              |

Scanning opens the guide; installation still requires the visitor's confirmation. On iPhone/iPad, the guide explains the Safari steps because the website cannot open a native installation prompt. In-app browsers may require opening the page in Safari or another supported browser first. Installation availability and menu labels depend on the browser.

The guide selects iPhone/iPad or Android/desktop instructions using a local browser hint, including iPad desktop mode. The hint is not uploaded or stored, and visitors can switch instructions manually. A direct install button appears only when the browser supplies an installation prompt. An installed standalone window hides the installation actions and offers a link back to ScaleTag.

The homepage QR code contains `${PUBLIC_ORIGIN}/install`, using the configured public origin rather than the incoming Host header. It is separate from each poll's QR code, which opens that poll's voting page.

The manifest includes stable app identity, 192/512px icons, a maskable icon and Create/VoteList shortcuts where supported. An Apple touch icon is included. The PNG icons are raster exports of the existing SVG brand mark; no image-generation service is used.

The service worker caches **only an explicit allowlist of public static resources and a generic offline page**. It never caches page URLs, poll HTML, API responses, QR responses, external images or POST requests. An offline navigation displays a connection message rather than old poll contents. Publishing, voting, GPS searches and current results require a network connection. Requests are never queued for background submission. The existing seven-day voting and 30-day public expiry checks stay on the server.

Service-worker versions are derived from a content hash of the static assets and generic HTML, so releases trigger browser update detection without manual version bumps. A new worker waits until the user selects **Update & reload**; the notice warns them to finish or copy an unsent draft. Other open windows are not forcibly reloaded. Older ScaleTag static caches are removed on activation. Browsers need an initial successful online visit to prepare offline resources.

API/page responses keep `Cache-Control: no-store`; only the allowlisted static files use `no-cache` for revalidation. Service-worker code is itself served with `no-store` and root scope. No additional backend, database, push service or app-store account is required.

Browser regression tests use isolated local data and check installation metadata, icons, cache contents, offline rejection of writes, reconnection, expiry, homepage QR navigation, platform-specific guides, standalone mode and user-approved updates. Native install prompts are simulated in Chromium tests; these tests do not verify installation through a physical phone's operating system.

```sh
npm ci --ignore-scripts
npx playwright install --with-deps chromium
npm run test:pwa
```

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
SYSTEM_UPDATE_REVISION=$(date -u +%Y%m%dT%H%M%SZ) docker compose up --build --detach --wait
docker compose ps
docker compose logs --tail 30 app
```

Point your host's cloudflared tunnel to `http://127.0.0.1:3000`. There is no public HTTP port. Set `SCALETAG_PORT` if another local service already uses port 3000. Do not publish to `0.0.0.0` on the host; Docker-published ports can bypass UFW.

For loopback-only local development without an HTTPS proxy:

```sh
NODE_ENV=development PUBLIC_ORIGIN=http://127.0.0.1:3000 docker compose up --build --detach --wait
```

The image uses Node.js 24 Alpine with `apk update` / `apk upgrade --no-cache` in a shared base stage, production-only dependencies, a non-root user, an HTTP health check and a file-based writer lock. Compose additionally sets a read-only root filesystem, drops Linux capabilities, limits memory to 256 MiB, disables core dumps and rotates startup/error logs. `.dockerignore` uses an allowlist so credentials, environment files and runtime data never enter image layers.

Poll JSON is stored in the **`poll-data` named volume**, mounted at `/data`. `docker compose down` preserves that volume. Rebuilding or recreating the app preserves poll contents, votes and deduplication records. **`docker compose down --volumes` permanently deletes the named-volume data.** Do not use it for routine upgrades.

To use an existing host directory, set `SCALETAG_DATA_SOURCE` to its absolute path and `SCALETAG_UID` / `SCALETAG_GID` to its numeric owner. Prepare a new directory with that ownership and mode `0700` before starting; the non-root container will not change its ownership for you. The default named volume uses UID/GID 1000.

Only one app instance may use a data directory. The entrypoint's `flock` prevents a second container or the native service from writing concurrently. Stop the existing service before migrating the same directory. Compose files and images contain no tunnel credentials.

## Storage and concurrency

[lowdb](https://github.com/typicode/lowdb) is the embedded JSON document store. Each poll lives in its own `<id>.json` file under `DATA_DIR`. An in-memory metadata index is rebuilt from files at startup; it is not a second retained copy. Voter identifiers are hashed and kept only for the voting period. No voter IPs, user agents, or browser fingerprints are stored.

Mutations to one poll run in a serialized queue. A vote's count and deduplication record are written together through lowdb's atomic temporary-file-and-rename adapter. **Only one application process may write a data directory.** Both the native systemd unit and the container entrypoint enforce this with `flock`. Do not run clustered Node workers, multiple containers, or manual second processes against the same directory.

Atomic rename prevents partial JSON writes; it is not a guarantee against all storage or power failures. This small-file design trades throughput for low operational cost and does not support multi-host deployments.

## Privacy and deletion

Each poll uses a different random cookie, scoped to that poll's API path, with `HttpOnly`, `Secure` in HTTPS mode, and `SameSite=Strict`. Its expiry is the poll's closing time. The active store removes its SHA-256 digest after closing; archived copies follow the backup retention policy below. Clearing cookies, changing browsers, or private browsing can bypass this protection: **one browser is not one verified person**.

Location filters use a POST body, so the querying coordinates are not added to URLs, and are discarded after the request. No analytics, request access logs, or account system are included. The ordinary interface uses system fonts; optional maps load map-label glyphs and basemap resources from OpenFreeMap. Cloudflare and the host still process network information. External images load only when the viewer explicitly asks; their hosts may receive connection information.

Expired records are inaccessible at the exact 30-day deadline. A cleanup runs every 30 seconds and on startup to remove active files and erase closed polls' deduplication hashes. Private daily backups can contain poll contents, GPS and hashes that existed at backup time. Each archive is retained for 90 days after its creation, so a poll's final archived copy can remain for up to about 120 days after publication. There is no public recovery interface; recovering a record does not extend its original public expiry.

Filesystem cleanup and archive pruning can be delayed by downtime or storage failure. Deletion unlinks files; it is not forensic erasure of underlying storage sectors. Provider snapshots and external backups are separate operator policies. Downloaded QR images and copies made by third parties cannot be recalled.

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

`deploy/deploy.sh` stages a release, switches the symlink and restarts the service. The root-managed helper pulls the current base image, passes the commit as `SYSTEM_UPDATE_REVISION` to invalidate the system-update layer for every new release, builds a revision-tagged image and starts the container with `/ScaleTag/data` mounted directly. Failed restarts or host health checks restore the previous release. The previous native release remains usable for the initial migration rollback. Current and previous source releases are retained separately from the daily data archives. Review old `scaletag:<commit>` images periodically and remove unused revisions explicitly; never prune unrelated images or volumes on a shared server.

GitHub Actions tests pull requests on GitHub-hosted Ubuntu, including a real Docker image build and isolated container persistence test. Deployment only runs on `main` using the self-hosted runner **eons**. The VM's Docker access stays restricted to the root-managed service. Protect `main` before accepting outside contributions.

## Daily archives and 90-day retention

The development VM runs `scaletag-backup.timer` at **03:00 America/Toronto** every day. `Persistent=true` catches up after downtime. The root-owned `scaletag-backup.service` runs `/usr/local/sbin/scaletag-backup`; the app and runner cannot read the archive directory through the container.

- Source: `/ScaleTag/data/<poll-id>.json` only; environment files, Docker layers, code, locks, external images and credentials are excluded.
- Destination: `/ScaleTag/backups/scaletag-data-<UTC-timestamp>.tar.gz`.
- Permissions: root-only directory `0700`, archive files `0600`.
- Retention: each archive is removed once it reaches 90 days, on the next successful daily cleanup. Only this tool's matching archive names are pruned.
- Integrity: gzip CRC, JSON parsing and a SHA-256 manifest are verified before the archive is atomically published. Failed/incomplete jobs do not publish a final archive.
- Availability: backup reads atomically replaced JSON documents without stopping the app. Each poll is consistent individually; the entire archive is not one global point-in-time transaction.
- Resource guard: reserve at least 512 MiB free disk space. Jobs are serialized and run with low CPU/I/O priority. Interrupted partial archives are cleared on the next run.

Install `deploy/backup.py`, `deploy/scaletag-backup.service` and `deploy/scaletag-backup.timer` root-owned at the paths above. Keep the helper outside runner-writable release directories. The app's data is not mounted into a backup container, and archives are not mounted into the app container.

```sh
sudo systemctl start scaletag-backup.service
sudo systemctl list-timers scaletag-backup.timer
sudo journalctl -u scaletag-backup.service -n 20
sudo /usr/local/sbin/scaletag-backup --verify /ScaleTag/backups/<archive>.tar.gz
```

For recovery, first verify and inspect an archive in a private staging directory. Stop the app before replacing any active records, preserve the original timestamps, and set recovered JSON ownership to the numeric app user with mode `0600`. Expired records will be pruned at startup. Historical records may be inspected offline by the administrator. No automated restore overwrites live data.

These are local archives on the same VM, not an offsite copy. Include their disk use when sizing the host.

## Initial operating cost

The existing VM, runner, and Cloudflare Tunnel are reused. The app introduces no separately billed database, image-storage service, paid maps API, or SaaS subscription. The optional map uses OpenFreeMap’s public service and adds client-side download/rendering work plus a locally served MapLibre dependency; it does not require a map server on the VM. Existing VM, domain, Cloudflare plan, bandwidth and host backup charges still depend on the operator's plans.

Default safety limits: 20 creations/minute globally, 10,000 retained polls, 50,000 votes per poll, and a 256 MiB free-disk reserve before accepting writes. The global creation limit uses no IP identifier and is a resource guard, not a strong abuse-prevention system. Each vote rewrites that poll's JSON, so very popular polls need a different persistence design. Start small, measure latency, memory and disk use, and scale only when needed. The 256 MiB application/container limit is a ceiling, not measured consumption. Docker Engine and containerd add their own host overhead; measure them separately.

## Tests

```sh
npm run check
npm test
npm run test:pwa
npm run test:map
python3 -m unittest discover -s test -p '*_test.py' -v
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
