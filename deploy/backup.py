#!/usr/bin/env python3
"""Private, verified JSON archives; a separate lock keeps backup jobs serialized."""
import argparse
import fcntl
import gzip
import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import shutil
import stat
import sqlite3
from contextlib import closing
import tarfile
import tempfile
from datetime import datetime, timedelta, timezone

ARCHIVE = re.compile(r"scaletag-data-(\d{8}T\d{6}\.\d{6}Z)\.tar\.gz\Z")
DOCUMENT = re.compile(r"([a-f0-9]{24})\.json\Z")
MEMBER = re.compile(r"data/([a-f0-9]{24})\.json\Z")
STAMP = "%Y%m%dT%H%M%S.%fZ"
RESERVE_BYTES = 512 * 1024 * 1024


def validate_document(raw, identifier):
    value = json.loads(raw)
    if (not isinstance(value, dict) or value.get("id") != identifier
            or not isinstance(value.get("deleteAt"), (int, float))
            or isinstance(value.get("deleteAt"), bool)
            or not math.isfinite(value["deleteAt"])):
        raise ValueError("Invalid poll document in backup source")
    return value


def verify_archive(path):
    # Consume the gzip stream completely, including its CRC trailer.
    with gzip.open(path, "rb") as stream:
        while stream.read(1024 * 1024):
            pass
    actual = {}
    manifest = None
    seen = set()
    with tarfile.open(path, "r:gz") as archive:
        for member in archive:
            if not member.isfile() or member.name in seen:
                raise ValueError("Unexpected or duplicate archive member")
            seen.add(member.name)
            stream = archive.extractfile(member)
            if stream is None:
                raise ValueError("Unreadable archive member")
            raw = stream.read()
            if member.name == "manifest.json":
                manifest = json.loads(raw)
            else:
                match = MEMBER.fullmatch(member.name)
                if not match:
                    raise ValueError("Unexpected archive path")
                validate_document(raw, match.group(1))
                actual[member.name] = hashlib.sha256(raw).hexdigest()
    if (not isinstance(manifest, dict) or manifest.get("version") != 1
            or manifest.get("files") != actual or manifest.get("pollCount") != len(actual)):
        raise ValueError("Archive manifest or checksum mismatch")
    return manifest


def prune_archives(directory, now, retention_days):
    removed = 0
    for path in directory.iterdir():
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode):
            continue
        # With the backup lock held, these can only be remnants of interrupted jobs.
        if path.name.startswith(".scaletag-backup-") and path.name.endswith(".partial"):
            path.unlink()
            continue
        match = ARCHIVE.fullmatch(path.name)
        if not match:
            continue
        created = datetime.strptime(match.group(1), STAMP).replace(tzinfo=timezone.utc)
        if created <= now - timedelta(days=retention_days):
            path.unlink()
            removed += 1
    return removed


def source_documents(source, destination):
    database = source / "scaletag.sqlite"
    if database.exists() or database.is_symlink():
        if database.is_symlink() or not database.is_file():
            raise ValueError("SQLite source must be a regular file")
        # Online backup API creates a consistent private snapshot; never copy a
        # live database file. Release the live read lock before compression.
        with tempfile.TemporaryDirectory(prefix=".scaletag-snapshot-", dir=destination) as directory:
            snapshot = Path(directory) / "snapshot.sqlite"
            with closing(sqlite3.connect(database.resolve().as_uri() + "?mode=ro", uri=True, timeout=10)) as live:
                if any(DOCUMENT.fullmatch(path.name) for path in source.iterdir()):
                    marker = live.execute("SELECT value FROM metadata WHERE key='json-import'").fetchone()
                    if marker != ("complete",):
                        raise ValueError("Unimported legacy JSON exists; inspect storage before backup")
                with closing(sqlite3.connect(snapshot)) as copy:
                    live.backup(copy)
            with closing(sqlite3.connect(snapshot)) as copy:
                for identifier, document in copy.execute("SELECT id, document FROM posts ORDER BY id"):
                    if not DOCUMENT.fullmatch(identifier + ".json"):
                        raise ValueError("Invalid SQLite document identifier")
                    yield identifier, document.encode()
        return
    for path in sorted(source.iterdir()):
        match = DOCUMENT.fullmatch(path.name)
        if not match:
            continue
        try:
            descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        except FileNotFoundError:
            continue
        with os.fdopen(descriptor, "rb") as stream:
            if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
                raise ValueError("Backup source contains a non-regular document")
            yield match.group(1), stream.read()


def backup(data_directory, archive_directory, retention_days=90, now=None):
    now = now or datetime.now(timezone.utc)
    if retention_days < 1:
        raise ValueError("Retention days must be positive")
    source = Path(data_directory)
    destination = Path(archive_directory)
    if source.is_symlink() or not source.is_dir() or destination.is_symlink():
        raise ValueError("Backup directories must be real directories")
    destination.mkdir(parents=True, exist_ok=True, mode=0o700)
    if destination.stat().st_uid != os.geteuid():
        raise ValueError("Backup directory must be owned by the backup user")
    destination.chmod(0o700)
    lock_fd = os.open(destination / ".backup.lock", os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(lock_fd, "w") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        removed = prune_archives(destination, now, retention_days)
        if shutil.disk_usage(destination).free < RESERVE_BYTES:
            raise OSError("Insufficient free space for backup")
        fd, temporary = tempfile.mkstemp(prefix=".scaletag-backup-", suffix=".partial", dir=destination)
        os.close(fd)
        temporary = Path(temporary)
        final = destination / f"scaletag-data-{now.strftime(STAMP)}.tar.gz"
        files = {}
        try:
            with tarfile.open(temporary, "w:gz", compresslevel=6) as archive:
                for identifier, raw in source_documents(source, destination):
                    value = validate_document(raw, identifier)
                    if value["deleteAt"] <= now.timestamp() * 1000:
                        continue
                    if shutil.disk_usage(destination).free < RESERVE_BYTES + len(raw) * 2:
                        raise OSError("Insufficient free space for backup")
                    name = f"data/{identifier}.json"
                    info = tarfile.TarInfo(name)
                    info.size, info.mode, info.mtime = len(raw), 0o600, int(now.timestamp())
                    archive.addfile(info, io.BytesIO(raw))
                    files[name] = hashlib.sha256(raw).hexdigest()
                manifest = {"version": 1, "createdAt": now.isoformat(),
                            "retentionDays": retention_days, "pollCount": len(files),
                            "snapshotMode": "sqlite-consistent" if (source / "scaletag.sqlite").exists() else "per-document-atomic", "files": files}
                raw = (json.dumps(manifest, indent=2) + "\n").encode()
                info = tarfile.TarInfo("manifest.json")
                info.size, info.mode, info.mtime = len(raw), 0o600, int(now.timestamp())
                archive.addfile(info, io.BytesIO(raw))
            verify_archive(temporary)
            with temporary.open("rb") as stream:
                os.fsync(stream.fileno())
            os.replace(temporary, final)
            directory_fd = os.open(destination, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
            return {"archive": str(final), "pollCount": len(files), "retentionDays": retention_days,
                    "expiredArchivesRemoved": removed, "verified": True, "bytes": final.stat().st_size}
        finally:
            temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", default="/ScaleTag/data")
    parser.add_argument("--backup-dir", default="/ScaleTag/backups")
    parser.add_argument("--retention-days", type=int, default=90)
    parser.add_argument("--verify", type=Path)
    args = parser.parse_args()
    os.umask(0o077)
    if args.verify:
        manifest = verify_archive(args.verify)
        print(json.dumps({"verified": True, "pollCount": manifest["pollCount"], "createdAt": manifest["createdAt"]}))
    else:
        print(json.dumps(backup(args.data_dir, args.backup_dir, args.retention_days)))


if __name__ == "__main__":
    main()
