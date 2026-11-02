# Database and backup encryption

Deployment reads the repository secret `SCALETAG_ENCRYPTION_KEY`: exactly 64
hexadecimal characters, generated with `openssl rand -hex 32`. Keep a recovery
copy outside GitHub. Do not change this secret after migration without a separate
key rotation procedure.

The application uses the SQLCipher cipher in SQLite3MultipleCiphers, through the
pinned better-sqlite3-multiple-ciphers driver. This encrypts the database pages,
including schema and document contents, using AES. Page IVs, salts and integrity
metadata are managed by the database engine. Backup exports use AES-256-GCM,
with a new random 12-byte IV for every export and an authentication tag.

## Host bootstrap before deploying this change

An administrator must install the reviewed `deploy/install-encryption-key.py`
as root-owned mode 0755 `/usr/local/sbin/scaletag-install-encryption-key` and
allow the trusted deployment account to execute that exact helper via sudo.
It accepts the secret on stdin, validates it, refuses accidental key replacement,
and updates root-only `/etc/scaletag.env` atomically. No secret is placed in an
image or committed file. Systemd and Docker retain the runtime environment;
Docker administrators can inspect it, as accepted for this deployment.

Update root-owned `/etc/scaletag-ha/compose.ha.yaml` with the new encryption
environment entry, and install the reviewed `deploy/ha-rollout.sh` as
`/usr/local/sbin/scaletag-ha-rollout`. Preserve the current production Nginx
configuration and domain redirects; do not replace them with the old template.

The first deployment stops both writers, creates and verifies an AES-encrypted
recovery export, then converts the database in place and starts both new images.
This initial conversion has a short maintenance window. Later deployments retain
normal rolling updates. Old application images cannot open the encrypted file;
rollback after conversion requires an encryption-capable image or offline
recovery, rather than restarting the previous unencrypted driver.

Install `deploy/backup-encrypted.py` as the root-owned backup entrypoint
`/usr/local/sbin/scaletag-backup` before re-enabling the daily timer. It exports
through a running application container, verifies decryption in that container,
and atomically publishes an encrypted `.aes.json` archive. The application
container does not need access to the host backup directory. Stop the timer
during bootstrap/migration. The existing service's read-only system protections
and backup-directory permissions should be retained.

The new backup entrypoint converts existing `scaletag-data-*.tar.gz` archives
to encrypted envelopes and verifies them before unlinking each plaintext source.
Run it once successfully before re-enabling the daily timer. Legacy envelopes
can be decrypted to stdout with `node src/encrypt-archive.js`.
Do not claim pre-existing copies or storage-provider snapshots have been erased.

## Restore

With the same key provided via environment, feed an encrypted JSON export to:

    node src/restore-encrypted-backup.js /private/staging/restored.sqlite < backup.aes.json

The target must not exist. Authentication happens before the database is created;
all records are restored in one transaction and integrity-checked. Verify the
result offline before swapping active data, with both serving instances stopped.
Never put keys in shell arguments or logs.

## Verification

Tests cover missing and wrong keys, encrypted file contents, shared transactional
writes, offline conversion, repeated migration, authenticated backups and restore.
Legacy plaintext tests remain available for local development without a key.
