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

Public task replies show the submitted name and message. The reply form encrypts the separate phone and email fields in the sender’s browser. The task publisher’s browser uses the management password to decrypt them. Giveaways use likes and a public pickup location, without an offer or contact form. The app does not process payments.

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
- **Encryption.** SQLCipher encrypts SQLite pages on disk. Both instances receive the database key from root-managed host configuration at runtime. Daily backup exports use authenticated AES-256-GCM encryption. Administrators with the necessary access can read application records, which contain ciphertext for browser-encrypted reply contacts. See [encryption and recovery](docs/encryption.md) for the storage formats and restore tools.
- **Delivery.** GitHub-hosted CI runs application, browser, container and failover tests. Release images are published to Docker Hub by commit SHA. The production deployment timer checks the exact `main` commit’s successful CI run before pulling its image. It updates the standby before the primary and checks readiness. Operations configuration lives outside the public application repository.

## Browser encryption for task reply contacts

Reply authors can send a phone number or email address without knowing the publisher’s password. The public task key lets a reply author encrypt those fields before sending them, so the application database and backups hold contact ciphertext. The reply name and message remain public. The implementation uses Web Crypto in a secure browser context. See [`public/task-crypto.js`](public/task-crypto.js).

1. **Publish.** The browser generates the task management password from 32 random bytes (256 bits) and encodes it as 64 hexadecimal characters. It generates a per-task ECDH P-256 key pair and exports the public key as SPKI and the private key as PKCS#8. HKDF-SHA-256 derives an AES-256-GCM key from the password bytes using a random 16-byte salt and the `scaletag:task:private-key-wrap:v1` label. The browser encrypts the private key with a random 12-byte nonce and authenticates the public key as additional data. It sends the public key, wrapped private key and a separately derived authentication credential to ScaleTag. The task password stays in the browser during publication and management and stays out of the URL.
2. **Reply.** The sender’s browser gets the task public key and creates a fresh ECDH P-256 key pair for the reply. ECDH produces a 256-bit shared secret. HKDF-SHA-256 uses the 12-byte random AES-GCM nonce as its salt and includes both public keys and the task ID in its derivation context. AES-256-GCM encrypts the phone and email JSON with both public keys and the task ID as additional authenticated data. The server stores the sender’s ephemeral public key, nonce and ciphertext. Both encryption envelopes are versioned and encode binary fields in Base64. AES-GCM uses the Web Crypto default 128-bit authentication tag.
3. **Manage.** After verifying the separate authentication credential, ScaleTag returns the wrapped private key and encrypted reply contacts. The publisher’s browser uses the password to unwrap the private key, repeats the key agreement for each reply and displays the decrypted contacts. Save the management URL and password when publishing. If you lose the task password, ScaleTag cannot reset it or recover the encrypted contacts, even from a backup.

Access to stored records or storage encryption keys alone leaves the new contacts encrypted. The task publisher can save or share contacts after viewing them.

Tasks created before this feature that lack contact encryption keys cannot accept new replies. Legacy reply contacts may have been stored without browser encryption.

## Argon2id management passwords

For tasks, the browser derives a 256-bit authentication credential from the decoded password bytes using HKDF-SHA-256, the fixed salt `scaletag:task:hkdf-salt:v1` and the separate label `scaletag:task:auth-key:v1`. It sends the credential as 64 hexadecimal characters at publication and when requesting management data or changing task status. The credential grants access to the management API. Decrypting the new contact ciphertext requires the private key protected by the task password.

For giveaways, the server generates a separate 32-byte random password, encodes it as 64 hexadecimal characters and returns it once in the uncached creation response. The giveaway browser sends that password for verification. Both flows send the management credential in a same-origin JSON POST over HTTPS in production. The management page can copy the URL and password together as text.

### Hashing parameters

ScaleTag uses [@node-rs/argon2](https://github.com/napi-rs/node-rs/tree/main/packages/argon2) to produce an [Argon2id v1.3](https://www.rfc-editor.org/rfc/rfc9106) verifier for the task authentication credential or giveaway password. The production SQLite post document stores the verifier in `manageKeyHash` as a PHC string containing the algorithm, version, parameters, salt and derived hash.

| Setting | Value |
| --- | --- |
| Variant and version | Argon2id, `v=19` (0x13) |
| Memory | `m=19456` KiB (19 MiB) per operation |
| Time cost | `t=2` passes |
| Parallelism | `p=1` lane |
| Salt | 16 random bytes generated separately for each verifier |
| Derived hash | 32 bytes |

### Verification and compatibility

The server checks the submitted credential’s format, then verifies it before opening the SQLite write transaction. It rechecks the current post and its verifier inside the transaction before returning private information or changing state. Each application process permits two concurrent Argon2 operations. Excess work receives HTTP 429. Public responses omit the verifier.

The server also supports older management links with SHA-256 verifiers. SQLCipher separately encrypts the SQLite database pages at rest.

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
