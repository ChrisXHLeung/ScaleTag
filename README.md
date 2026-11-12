# ScaleTag

**A question. A place. Seven days.**

ScaleTag is a small, location-aware platform for polls and tasks with an English interface. No accounts, no image storage, no self-hosted map server, and no separate database server.

Production site: **https://risinfo.cn** and **https://www.risinfo.cn** (the previous `scaletag.risinfo.cn` hostname redirects here).

The production site runs on Oracle Cloud Infrastructure (OCI) with the lightweight **Nginx + two Node instances + shared SQLite** HA demonstration. The existing cloudflared tunnel connects to Nginx ingress. See the [architecture and demo commands](docs/ha-demo.md) and [verification results](docs/ha-verification.md).

## What it does

- Use the homepage for the introduction, and **`/create`** to create a poll with a title, plain-text description, up to three external HTTPS image URLs, 2–12 options, and an unverified signature.
- Publish a task at **`/create/task`** with a required title, description and free-text reward offer, plus an optional unverified name. Tasks remain available for 30 days.
- Track task progress as **Open**, **In progress**, **Completed** or **Closed** using a management URL and a password issued once at publication. Completed and Closed are final and stop new replies.
- Like polls and tasks anonymously. Task reply names and messages are public; the required phone number or email address (both are allowed) is private and shown only on the task's secret management page. Respondents explicitly acknowledge both rules.
- Require browser geolocation to publish. Store the coordinates with the poll without exposing exact coordinates in public API responses; publish only rounded map positions after explicit consent.
- Start immediately; accept a single choice for exactly **168 hours**.
- Display vote counts and percentages before and after voting. Refresh results every 15 seconds on visible poll pages.
- Generate a downloadable PNG QR code containing the canonical poll URL.
- List polls and tasks at **`/PostList`**, newest first, with open/ended filters and an optional **100 km** radius filter. Switch between List and Map; the homepage never lists polls.
- Remove the poll, results, location, and related identifiers from active storage **30 days after publication**. The original page and QR endpoint then return 404. Private daily archives are retained for **90 days after backup creation** for administrator-managed recovery.

## Pages

| Path           | Purpose                                                                                       |
| -------------- | --------------------------------------------------------------------------------------------- |
| `/`            | Introduction and QR code for installing the app; no poll listing.                             |
| `/create/task` | Publish a local task with a reward offer and required GPS/map acknowledgements.               |
| `/task/<id>`   | Read a task, like it, reply (public name/message, private contact), or save its QR code.      |
| `/task/<id>/manage#key=…` | Private management page: change a task's progress status and read reply contacts (requires the secret key). |
| `/create`      | Publish a single-choice poll with required GPS permission.                                    |
| `/PostList`    | Browse retained polls and tasks in List or Map view, with status and optional 100 km filters. |
| `/install`     | Device-specific PWA installation guide.                                                       |
| `/privacy`     | Explain cookies, location, deletion and private backup retention.                             |

Each published poll also has its own shareable URL and downloadable QR code. Installing the app does not create an account or change the anonymous voting rules.

The combined listing is named **PostList**. Old `/VoteList` links and installed-app shortcuts redirect permanently to `/PostList`, preserving query parameters. Poll and task URLs are unchanged.

## Free giveaways

The former sale feature now accepts free giveaways at `/create/sale`. A post requires a public pickup location and GPS/map consent, and may include photos. Visitors may like it without supplying contact details. The management URL and password let the publisher take it down; new giveaways become inaccessible after 72 hours. Older sale listings are removed from active storage by periodic cleanup, and the old offer endpoint no longer accepts submissions. New giveaways are removed from active storage 30 days after publication. Backups follow the existing 90-day archive retention policy.

## Tasks, likes and replies

Select **Poll** or **Task** in the publishing form. Tasks use the same required GPS permission, explicit approximate-map acknowledgement and 30-day website retention as polls. Reward is a required text description (for example, “CAD 30” or “a coffee”), not a payment instruction processed by ScaleTag. There are no accounts, checkout, deposits, escrow, bookings or transaction handling. The poster contacts respondents directly using the private contact details shown on the management page.

### Reply privacy

| Reply field | Who can see it |
| --- | --- |
| Name (optional, unverified) and message | **Public**: everyone, via the task page and `GET /api/posts/<id>/social`. Reply counts stay public in PostList and summaries. |
| Phone and/or email | **Private**: only someone with private management access, via the authenticated `POST /api/tasks/<id>/manage`; plus administrators with server access and the encrypted private backups (90-day policy). |

- On tasks with a management key, a reply requires a message and **at least one of phone or email**. The form separates the *public* name/message from the *private* contact fields and requires a `privacyAccepted` acknowledgement stating exactly this. Older clients that still send the former `contactAccepted` field are rejected with a message asking them to reload.
- Respondents are told never to put contact information in their name or message. The server rejects names/messages that look like they contain an email address or phone number (`+` international numbers, or 3-3-4 digit groups). This is a safety net, not a guarantee; dates, times and prices are not matched.
- No unauthenticated endpoint returns phone or email: `GET /api/tasks/<id>`, `GET /api/posts/<id>/social`, `POST /api/posts/<id>/likes`, `POST /api/posts/<id>/replies`, list/search, map and QR responses all omit them. Public replies contain only `id`, `name`, `message` and `createdAt`. This applies equally to replies stored before this change, whose contacts were previously public.
- **Legacy tasks** (published before management links) have no key, so nobody could ever view private contacts for them. ScaleTag therefore does not collect contacts there: the social response sets `acceptsPrivateContacts: false`, the form hides the contact fields and explains why, and the server rejects replies that include a phone or email (`400`). Contacts already stored on legacy tasks are hidden from everyone and removed with the task at its 30-day deadline.
- Replies share the **parent task's** 30-day deadline; replying does not extend it. There is no account-based editing, private messaging or self-service recovery. Private archives may retain contact details under the existing 90-day archive policy.

Each post has a separate random `ss_<id>` cookie, `HttpOnly`, `Secure` over HTTPS and `SameSite=Strict`, scoped to `/api/posts/<id>` and expiring at post deletion. Only its SHA-256 hash is stored for one-like-per-browser deduplication and reply throttling. This cookie is separate from the seven-day voting cookie, with no cross-post identifier, IP logging or device fingerprint. Clearing cookies or changing browsers can bypass browser-based limits. Likes are idempotent and serialized with votes/replies in the same per-document queue; liking never casts a vote. Polls support likes; replies are available on tasks.

Resource bounds: 50,000 likes per post by default, 200 replies per task, one reply per browser per task per minute, and 20 valid reply attempts per minute globally without IP identifiers. Poll/task creation shares the existing creation limit. These are low-cost resource guards, not identity verification or strong spam protection. Old poll JSON remains compatible; social fields initialize on first use. Daily backups include task JSON, replies and private deduplication hashes, with the same root-only permissions and retention.

### Task progress and private management

Every new task starts **Open**. Publishing a task or giveaway issues a 256-bit random management password once. The management page has a button that copies its URL and the password in a single message. Open that URL later and enter the password to change task status, view task reply contacts or take down a giveaway. Existing private fragment links continue to work.

| State         | Public badge | New replies | Can change to                     |
| ------------- | ------------ | ----------- | --------------------------------- |
| `open`        | Open         | Accepted    | `in_progress`, `completed`, `closed` |
| `in_progress` | In progress  | Accepted    | `open`, `completed`, `closed`     |
| `completed`   | Completed    | Rejected (`409`) | — final                      |
| `closed`      | Closed       | Rejected (`409`) | — final                      |

- **Secret handling.** New records store only a salted Argon2id verifier in `manageKeyHash`. Existing SHA-256 verifiers remain valid for the matching older credentials. SQLite discovery and public responses exclude verifiers. The password is kept out of new management URLs and is sent only in the body of a same-origin JSON POST. Private archives contain the verifier under the 90-day policy. Passwords cannot be recovered or reissued.
- **Authorization.** Missing, malformed or mismatched keys (including another task's key) return `403` and change nothing. The usual origin and JSON content-type checks apply. Polls have no states or keys.
- **Replies.** Completed and Closed are final; existing replies stay visible, new replies are rejected by the server and the reply form is replaced by a notice. Likes stay available.
- **Retention.** Changing status updates only `taskState` and `stateChangedAt`. `createdAt`, `endsAt` and the 30-day `deleteAt` are never changed, so a task and its management link stop working exactly 30 days after publication (`404`).
- **Discovery.** Completed and Closed tasks are treated as ended: they appear under **Ended** in PostList and as ended markers on the map. Open and In progress tasks appear under **Open**. Tasks expose `taskState` publicly.
- **Compatibility.** Tasks stored before this feature have no `taskState`/`manageKeyHash`. They are shown as **Open**, keep accepting replies (public name and message only — no contacts, see [Reply privacy](#reply-privacy)) and cannot be managed, because no key was ever issued. No data migration is needed for JSON or SQLite storage.

| Endpoint                                   | Purpose                                                                                                                                            |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/tasks`                          | Publish a task.                                                                                                                                    |
| `GET /api/tasks/<id>`                      | Read public task content, without reply contacts.                                                                                                  |
| `GET /api/tasks/<id>/qr.png`               | Canonical task QR; `?download=1` saves a PNG.                                                                                                      |
| `GET /api/posts`, `POST /api/posts/search` | Mixed newest-first discovery with `type=all/poll/task`, status and optional nearby filters. Historic `/api/polls` discovery routes remain aliases. |
| `GET /api/posts/<id>/social`               | Public like state and task replies (name/message only, never phone/email) plus `acceptsPrivateContacts` for tasks; establishes this post's anonymous cookie. |
| `POST /api/posts/<id>/likes`               | Add one idempotent browser like. Returns the same public social data.                                                                              |
| `POST /api/posts/<id>/replies`             | Add a task reply with `privacyAccepted: true`. Returns public social data without contacts.                                                        |
| `POST /api/tasks/<id>/manage`              | Verify a management key (`{ "key": "…" }`) and return the task **with reply phone/email**. `403` for a missing or wrong key. `Cache-Control: no-store, private`. |
| `POST /api/tasks/<id>/state`               | Change progress with `{ "key": "…", "state": "open" \| "in_progress" \| "completed" \| "closed" }`. `409` once a task is completed or closed.       |

All API responses use `no-store`. No task, reply, contact, like/vote request or QR response is placed in the PWA cache, and offline submissions are never queued. Browser tests run with isolated temporary data:

```sh
npm run test:tasks
```

## Map view

PostList opens in **List** view. Choosing **Map** loads [MapLibre GL JS](https://maplibre.org/) 6.16.0 from ScaleTag and the Positron basemap from [OpenFreeMap](https://openfreemap.org/). There is no map API key, registration, separate map server or additional paid service. OpenFreeMap currently offers free public map hosting, including commercial use, without map-view quotas; it provides no SLA. Keep the OpenMapTiles/OpenStreetMap attribution visible. Map availability depends on the provider and the visitor's network/browser; List remains available independently.

- Open polls use blue dots; ended polls use red dots. Numbered groups expand on click. Select a dot to open a poll; polls sharing a rounded position appear together in the popup.
- Content type (Polls & tasks / Polls / Tasks), status and optional 100 km filters apply to both views. Nearby matching uses the original GPS on the server; the requesting visitor's coordinates are discarded after the search.
- The map shows only posts created with explicit map consent (`mapVisible: true`). The creation form requires acknowledgement before publishing. Existing polls and API clients without this flag remain list-only; they are not retroactively exposed.
- Public markers use a stable **0.01° latitude/longitude grid**, roughly 1.1 km north–south and narrower east–west. Exact GPS stays in the private JSON store. A rounded position is an approximate area, not an anonymity guarantee; an original coordinate already on the grid is unchanged.
- At most the **newest 1,000 matching mapped posts** are returned. The interface shows the returned and total counts; use filters to narrow large sets. A text list of mapped posts is available below the map for keyboard and assistive-technology access.
- Marker searches use `POST /api/map/search` and `no-store`. No coordinates are put in URLs. Current markers refresh at most every 30 seconds and at upcoming closing/deletion boundaries while the page is visible. Failed refreshes and offline mode clear markers rather than presenting retained results as current.

Choosing Map sends the visitor's IP address and requested map areas to OpenFreeMap. Post titles, rewards, contacts, signatures and votes are not sent to the map provider. The MapLibre module, CSS and worker are served locally from a pinned dependency; the map connects only to `tiles.openfreemap.org`. Third-party map resources, marker responses and map-library files are excluded from the PWA cache. The browser may cache basemap resources under the provider's own headers; ScaleTag does not download offline map areas. MapLibre uses WebGL, with List as the fallback on unsupported devices.

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

The manifest includes stable app identity, 192/512px icons, a maskable icon and Create/PostList shortcuts where supported. An Apple touch icon is included. The PNG icons are raster exports of the existing SVG brand mark; no image-generation service is used.

The service worker caches **only an explicit allowlist of public static resources and a generic offline page**. It never caches page URLs, poll HTML, API responses, QR responses, external images or POST requests. An offline navigation displays a connection message rather than old poll contents. Publishing, voting, likes, replies, GPS searches and current results require a network connection. Requests are never queued for background submission. The existing seven-day voting and 30-day public expiry checks stay on the server.

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

## High-availability demonstration

The two-instance demonstration uses **Nginx ingress + primary/backup Node containers + shared SQLite**, with no separate database service. The existing cloudflared tunnel connects only to ingress. Updates replace app2, verify readiness, take app1 offline so ingress fails over, update app1, then verify automatic failback. See [HA architecture, resource choices, migration and demo commands](docs/ha-demo.md).

`compose.ha.yaml` is the HA topology; `compose.yaml` below remains the legacy single-instance JSON setup. The first conversion requires an administrator bootstrap and verified data import. The deployment pipeline refuses to change the existing VM until that bootstrap is complete.

## Run in Docker (legacy single instance)

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

For the legacy JSON backend, only one app instance may use a data directory. The entrypoint's `flock` prevents a second JSON container or the native service from writing concurrently. Stop the existing service before migrating the same directory. Compose files and images contain no tunnel credentials.

## Storage and concurrency

For the HA demo, set `STORAGE_BACKEND=sqlite` (already configured in `compose.ha.yaml`). Both apps mount the same local directory, and SQLite transactions protect counts, deduplication and shared rate limits. Lists/maps read current database data. Each post is a JSON document inside the `posts.document` column of `/data/scaletag.sqlite`; SQLite is the primary store, not just an index. The deployed database is encrypted as described below. Native development defaults to `json`; the following file-lock restrictions apply to that legacy backend only.

[lowdb](https://github.com/typicode/lowdb) is the embedded JSON document store. Each poll lives in its own `<id>.json` file under `DATA_DIR`. An in-memory metadata index is rebuilt from files at startup; it is not a second retained copy. Voter identifiers are hashed and kept only for the voting period. No voter IPs, user agents, or browser fingerprints are stored.

Mutations to one poll run in a serialized queue. A vote's count and deduplication record are written together through lowdb's atomic temporary-file-and-rename adapter. **Only one application process may write a data directory.** Both the native systemd unit and the container entrypoint enforce this with `flock`. Do not run clustered Node workers, multiple containers, or manual second processes against the same directory.

Atomic rename prevents partial JSON writes; it is not a guarantee against all storage or power failures. This small-file design trades throughput for low operational cost and does not support multi-host deployments.

## Privacy and deletion

Each poll uses a different random cookie, scoped to that poll's API path, with `HttpOnly`, `Secure` in HTTPS mode, and `SameSite=Strict`. Its expiry is the poll's closing time. The active store removes its SHA-256 digest after closing; archived copies follow the backup retention policy below. Clearing cookies, changing browsers, or private browsing can bypass this protection: **one browser is not one verified person**.

Location filters use a POST body, so the querying coordinates are not added to URLs, and are discarded after the request. No analytics, request access logs, or account system are included. The ordinary interface uses system fonts; optional maps load map-label glyphs and basemap resources from OpenFreeMap. Cloudflare and the host still process network information. External images load only when the viewer explicitly asks; their hosts may receive connection information.

Expired records are inaccessible at the exact 30-day deadline. A cleanup runs every 30 seconds and on startup to remove active records and clear closed polls' deduplication hashes. Private daily backups can contain poll contents, GPS and hashes that existed at backup time. Each archive is retained for 90 days after its creation, so a poll's final archived copy can remain for up to about 120 days after publication. There is no public recovery interface; recovering a record does not extend its original public expiry.

Filesystem cleanup and archive pruning can be delayed by downtime or storage failure. Deletion unlinks files; it is not forensic erasure of underlying storage sectors. Provider snapshots and external backups are separate operator policies. Downloaded QR images and copies made by third parties cannot be recalled.

## Security and encryption

The deployed HA service encrypts its SQLite database and private backups. Native
JSON development and SQLite instances started without a key remain unencrypted;
creating a GitHub Secret alone does not enable encryption in another installation.

| Layer | Deployed design |
| --- | --- |
| Network entry | Cloudflare HTTPS → cloudflared → loopback Nginx → two Node containers. The host firewall denies unsolicited inbound traffic except management access; SSH uses key authentication. |
| Database at rest | `better-sqlite3-multiple-ciphers` uses its SQLCipher AES cipher to encrypt database pages, including schema and document contents. Both instances share the encrypted `scaletag.sqlite` file. |
| Key delivery | GitHub Actions reads the repository secret `SCALETAG_ENCRYPTION_KEY` and sends it on stdin to a root-owned installation helper. The helper atomically updates `/etc/scaletag.env`, owned by root with mode `0600`. Systemd and Compose supply the key to both containers as a runtime environment variable. |
| Filesystem access | The app runs as the data directory's non-root UID/GID. The data directory is private and the database is mode `0600`. Private archives use a root-only directory (`0700`) and files (`0600`), with no archive-directory mount in the app containers. |
| Backup at rest | Consistent database exports are encrypted with AES-256-GCM, a fresh random 12-byte IV per export, and an authentication tag. Existing local legacy archives are encrypted and verified before their plaintext source files are unlinked. |

The only operator-provided encryption secret is **`SCALETAG_ENCRYPTION_KEY`**.
Generate it locally and save the complete output as a **Repository secret** in
GitHub → Settings → Secrets and variables → Actions:

```sh
openssl rand -hex 32
```

The result must be exactly 64 hexadecimal characters (256 random bits). No separate
IV secret is needed: the database engine manages page IVs and salts; the backup
code generates a new IV for each encryption. IVs and authentication tags are stored
with ciphertext and do not need to be secret. Keys are never committed, baked into
images, passed as command-line arguments, or intentionally written to logs.

The installation helper rejects an invalid key or replacement of an existing key.
The first migration stops both writers, creates and verifies an encrypted recovery
export, encrypts the database, then starts both new instances. Later updates use
rolling deployment. Missing or incorrect keys cannot open the encrypted database;
the application does not silently fall back to plaintext. See the
[bootstrap, migration and recovery instructions](docs/encryption.md).

**Protection boundary:** encryption protects a database or backup file obtained
without its key. The running application decrypts data in memory. The key remains
in the root-managed host environment file and Docker container configuration so
restarts can recover automatically. Host root and Docker administrators can read
it, including through `docker inspect`; runtime environment injection was chosen
for deployment simplicity. Firewall and Tunnel routing restrict network access,
but do not replace application validation or protect against every application
vulnerability. Encryption does not hide content intentionally returned by public
APIs, such as task reply names and messages, nor contacts returned to a valid
management-link holder.

Keep a secure recovery copy of the key outside GitHub. Losing it can make the
stored data unrecoverable. Changing the GitHub Secret is not a key rotation
procedure: existing databases and archives still need their original key.
Removing plaintext files is not forensic erasure, and independent offsite copies
or provider snapshots are outside this local encryption migration.

## Deployment on the development VM

The [HA pipeline](docs/ha-demo.md#rolling-pipeline) deploys only after CI passes
on the exact main SHA. Pull-request tests run on GitHub-hosted runners; production
deployment runs on the dedicated self-hosted runner **eons**.

```text
Cloudflare HTTPS → cloudflared → loopback Nginx
                                  ├─ Node app1 ─┐
                                  └─ Node app2 ─┴─ /data/scaletag.sqlite (encrypted)
```

- `/ScaleTag/releases/<commit>/`: source releases and Docker build context.
- `/ScaleTag/current`: symlink to the selected release.
- `/ScaleTag/data/`: persistent encrypted SQLite storage, mounted at `/data` in both apps; never copied into images or releases.
- `/etc/scaletag.env`: root-only environment, including `PUBLIC_ORIGIN=https://risinfo.cn` and the encryption key.
- `/etc/scaletag-ha/`: root-managed Compose and ingress configuration. Preserve the production hostname redirects when updating templates.
- `scaletag.service`: invokes the root-owned `/usr/local/sbin/scaletag-ha-rollout` helper.

The runner has no Docker socket access. Its narrowly scoped passwordless sudo
commands install the key through `/usr/local/sbin/scaletag-install-encryption-key`
and restart `scaletag.service`. Host bootstrap installs these reviewed helpers
outside runner-writable release directories. Building the native SQLite driver
requires Python, `make` and a C++ compiler; the Docker build supplies these in its
build stage, and the self-hosted runner also needs them for deployment tests.

`deploy/deploy.sh` stages a release and restarts the root-managed service. The
helper builds revision-tagged images, updates app2, checks readiness, moves traffic
off app1, updates app1 and verifies failback. The initial encryption conversion has
a short maintenance window. Previous images using the unencrypted driver cannot
open the encrypted database; recovery after conversion requires an
encryption-capable image or an offline restore. Protect `main` and deployment
permissions, since deployed code can access plaintext data and the runtime key.
The [earlier JSON deployment notes](docs/ha-demo.md#one-time-conversion-of-the-existing-vm)
are migration reference, not the current persistence layout.

## Daily archives and 90-day retention

The VM runs `scaletag-backup.timer` at **03:00 America/Toronto** daily, with
`Persistent=true` to catch up after downtime. The root-owned backup service uses
`deploy/backup-encrypted.py`, installed as `/usr/local/sbin/scaletag-backup`.

- Source: a consistent read transaction exports posts, metadata and rate-limit state through a running application container. A live database file is never copied directly.
- Destination: `/ScaleTag/backups/scaletag-data-<UTC-timestamp>.aes.json`. The JSON envelope contains ciphertext, IV and authentication tag; its payload is not readable without the key.
- Verification: the export is authenticated and decrypted for verification before the archive is atomically published. Failed jobs do not publish a completed new archive.
- Legacy conversion: retained `scaletag-data-*.tar.gz` archives are encrypted, verified and then replaced by `.tar.gz.aes.json` envelopes. These use a separate legacy-archive payload format.
- Retention: matching daily archives are removed after 90 days, during a successful backup run. Jobs are serialized with a file lock.
- Permissions: backup directory `0700`, archive files `0600`; the host backup directory is not mounted into application containers.

```sh
sudo systemctl start scaletag-backup.service
sudo systemctl list-timers scaletag-backup.timer
sudo journalctl -u scaletag-backup.service -n 20
```

With the same key supplied securely through the environment, restore a current
export to a **new** database path in a private staging directory:

```sh
node src/restore-encrypted-backup.js /private/staging/restored.sqlite < backup.aes.json
```

The tool authenticates the backup before creating the target, restores records
in a transaction, and checks database integrity. It refuses an existing target.
Legacy `.tar.gz.aes.json` envelopes instead use `src/encrypt-archive.js` to decrypt
the original archive to stdout; they are not inputs to the database restore tool.

Validate a restored database offline before replacing active storage, stop both
instances for the swap, preserve timestamps and ownership, and retain the original
until recovery is verified. Expired records are cleaned up on application startup;
restoration does not extend public expiry. These archives are on the same VM;
offsite copies require a separate operator policy. The former unencrypted
`deploy/backup.py` remains for legacy development and must not replace the
production encrypted backup entrypoint.

## Initial operating cost

The existing VM, runner, and Cloudflare Tunnel are reused. The app introduces no separately billed database, image-storage service, paid maps API, or SaaS subscription. The optional map uses OpenFreeMap’s public service and adds client-side download/rendering work plus a locally served MapLibre dependency; it does not require a map server on the VM. Existing VM, domain, Cloudflare plan, bandwidth and host backup charges still depend on the operator's plans.

Default safety limits: 20 creations/minute globally, 10,000 retained polls, 50,000 votes per poll, and a 256 MiB free-disk reserve before accepting writes. The global creation limit uses no IP identifier and is a resource guard, not a strong abuse-prevention system. Each vote updates its post document; SQLite serializes writers, so measure contention before supporting very popular polls. Start small, measure latency, memory and disk use, and scale only when needed. The 256 MiB application/container limit is a ceiling, not measured consumption. Docker Engine and containerd add their own host overhead; measure them separately.

## Tests

```sh
npm run check
npm test
npm run test:pwa
npm run test:map
npm run test:tasks
python3 -m unittest discover -s test -p '*_test.py' -v
```

With Docker available, verify an already built image using an isolated named volume:

```sh
PUBLIC_ORIGIN=https://scaletag.test docker compose build
npm run test:container
```

The container test always uses its own project, local port and disposable volume. It checks startup, non-root execution, read-only root, memory configuration, loopback publishing, Secure cookies, QR generation, single-writer locking, graceful SIGTERM, and persisted votes, likes, task replies and deduplication after container recreation. Only its isolated test volume is removed afterward.

Integration tests cover concurrent duplicate submissions, distinct votes, persisted counts across reload, exact 7/30-day boundaries, startup cleanup, 100 km boundaries, pagination, privacy, origin enforcement, size limits, and QR PNG downloads. Test files use isolated temporary directories.

## License

MIT. See [LICENSE](LICENSE).

The HA integration suite additionally runs `docker build --tag scaletag:ha-test .` followed by `npm run test:ha`. It uses its own disposable project and checks Nginx failover/failback, shared data, concurrent writes, rolling updates under traffic and both failure rollback paths.
