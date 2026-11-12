# ScaleTag

ScaleTag is an installable, bilingual web app for local polls, tasks and free giveaways. No account is required. Publish a post, share its link or QR code, and find nearby posts in PostList.

[Open ScaleTag](https://risinfo.cn/) · [Privacy and retention](https://risinfo.cn/privacy) · [Architecture case study](https://www.chriscn.cn/scaletag/)

## Posts and their lifetimes

| Type | What people can do | Public lifetime |
| --- | --- | --- |
| Poll | Vote, see results and like the post | Voting closes after seven days. Results remain available until day 30. |
| Task | Offer a reward, receive replies and update progress | Available for 30 days. Completed and Closed tasks stop accepting new replies. |
| Free giveaway | Share a public pickup location and receive likes | Public for up to 72 hours. The publisher can take it down sooner. Active storage retains the record until day 30. |

Each post has a unique ID. PostList combines all three types in one list and an optional map. Publishing requires a location. Public map pins use a rounded 0.01° grid, and posts appear there only with explicit consent. A giveaway’s written pickup location is public. Search coordinates are used for that request and are not stored.

Public task replies show the submitted name and message. A reply’s phone number and email are available through authenticated task management and may be present in private backups. Giveaways use likes and a public pickup location, without an offer or contact form. The app does not process payments.

| Page | Path |
| --- | --- |
| Publish | [Poll](https://risinfo.cn/create), [task](https://risinfo.cn/create/task), [giveaway](https://risinfo.cn/create/sale) |
| Discover | [PostList](https://risinfo.cn/PostList) and its optional map |
| View a post | `/vote/<id>`, `/task/<id>`, `/sale/<id>` |
| Manage a post | `/task/<id>/manage`, `/sale/<id>/manage` |
| Install and learn about data | [Install](https://risinfo.cn/install), [privacy](https://risinfo.cn/privacy) |

## Production architecture

```text
Browser ─ HTTPS ─ Cloudflare Tunnel ─ Nginx on OCI Host
                                       ├─ app1 (primary) ─┐
                                       └─ app2 (standby) ─┴─ encrypted SQLite
```

- **Ingress and runtime.** Nginx forwards to two Node.js 24 containers on the same host. The primary and standby share local storage. This provides app-instance failover, with the host and local disk as shared failure points.
- **Storage.** SQLite is the production store. The `posts.id` primary key identifies each post, and `posts.document` contains its full JSON record, including uploaded images. SQLite transactions protect state changes, voting and like deduplication, and shared rate limits.
- **Encryption.** SQLCipher encrypts SQLite pages on disk. Both instances receive the database key from root-managed host configuration at runtime. Daily backup exports use authenticated AES-256-GCM encryption. Application and host administrators with the necessary access can read data in use. See [encryption and recovery](docs/encryption.md) for the storage formats and restore tools.
- **Delivery.** GitHub-hosted CI runs application, browser, container and failover tests. Release images are published to Docker Hub by commit SHA. The production deployment timer checks the exact `main` commit’s successful CI run before pulling its image. It updates the standby before the primary and checks readiness. Operations configuration lives outside the public application repository.

## Argon2id management passwords

ScaleTag issues a separate password for each new task and giveaway. At publication the server generates 32 cryptographically random bytes (256 bits) and encodes them as 64 hexadecimal characters. The password is returned once in the uncached creation response. The management page can copy the URL and password together as text. The password stays out of the URL and is sent for verification in the body of a same-origin JSON POST over HTTPS in production.

### Hashing parameters

ScaleTag uses [@node-rs/argon2](https://github.com/napi-rs/node-rs/tree/main/packages/argon2) to produce an [Argon2id v1.3](https://www.rfc-editor.org/rfc/rfc9106) verifier. The production SQLite post document stores the verifier in `manageKeyHash` as a PHC string containing the algorithm, version, parameters, salt and derived hash.

| Setting | Value |
| --- | --- |
| Variant and version | Argon2id, `v=19` (0x13) |
| Memory | `m=19456` KiB (19 MiB) per operation |
| Time cost | `t=2` passes |
| Parallelism | `p=1` lane |
| Salt | 16 random bytes generated separately for each verifier |
| Derived hash | 32 bytes |

### Verification and compatibility

The server checks the submitted password's format, then verifies it before opening the SQLite write transaction. It rechecks the current post and its verifier inside the transaction before returning private information or changing state. Each application process permits two concurrent Argon2 operations. Excess work receives HTTP 429. Public responses omit the verifier, and ScaleTag cannot recover a lost password.

Older management links continue to use their original SHA-256 verifiers. The two application instances gained support for reading both formats before new posts began issuing Argon2id credentials. Argon2id protects the management password. SQLCipher separately encrypts the SQLite database pages at rest.

## Data and retention

- Poll votes use a per-poll random cookie. Likes, replies and reports share a separate per-post random cookie. Server-side deduplication uses hashes. Vote hashes are cleared after voting ends. The application has no account or fingerprinting system and does not keep HTTP access logs. Infrastructure providers and host security logs can still process connection information.
- Each browser cookie can report a post once. A sixth distinct report permanently freezes the post, including its detail page and management access, and removes it from the list and map. The record follows the regular retention schedule.
- Uploaded photos are re-encoded and their metadata is stripped. Anything visible in a photo remains visible to viewers. External HTTPS images load on request from their hosts. The optional map uses OpenFreeMap, which receives requests from the viewer’s browser.
- The installable app caches selected interface assets and a generic offline page. It does not cache private management data or queue offline submissions.
- The service removes posts from active storage at day 30, with cleanup running on startup and approximately every 30 seconds during normal operation. Backups may contain earlier copies. Each backup is retained for up to 90 days after the backup was made, so the last archived copy of a post may remain for about 120 days after publication. Recovery preserves original expiry dates.

## Run locally

Use Node.js 22 or later. Native development defaults to the single-writer JSON store and serves HTTP on loopback.

```sh
npm ci --ignore-scripts
npm rebuild better-sqlite3-multiple-ciphers
npm start
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). Configure the app with environment variables listed in [`.env.example`](.env.example). Production requires an HTTPS `PUBLIC_ORIGIN`. Use a separate data directory for local tests.

- [`compose.yaml`](compose.yaml) runs the single-instance development topology.
- [`compose.ha.yaml`](compose.ha.yaml) defines Nginx and two instances sharing SQLite.
- [HA setup and migration reference](docs/ha-demo.md) describes the Compose topology and historical conversion steps.

## Verification

```sh
npm run check
npm test
npx playwright install chromium
npm run test:pwa
npm run test:map
npm run test:tasks
npm run test:sales
npm run test:locale
python3 -m unittest discover -s test -p '*_test.py' -v
```

For container and failover checks, follow the [GitHub Actions workflow](.github/workflows/ci.yml). Tests use disposable data, so they can exercise expiry, private replies, Argon2id verification and recovery without touching production records.

## License

[MIT](LICENSE)
