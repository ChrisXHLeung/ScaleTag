import fcntl
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tarfile
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("backup", Path(__file__).resolve().parents[1] / "deploy/backup.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.data = self.root / "data"
        self.archives = self.root / "archives"
        self.data.mkdir()
        self.now = datetime(2026, 10, 26, 7, tzinfo=timezone.utc)
        self.id = "a" * 24
        self.record = {"id": self.id, "deleteAt": (self.now + timedelta(days=30)).timestamp() * 1000,
                       "options": [{"id": 1, "label": "A", "votes": 2}], "totalVotes": 2,
                       "location": {"latitude": 0, "longitude": 0}, "voters": {"digest": True}}
        self.document = self.data / f"{self.id}.json"
        self.document.write_text(json.dumps(self.record))

    def run_backup(self, **kwargs):
        return module.backup(self.data, self.archives, now=self.now, **kwargs)

    def test_verified_archive_contains_exact_documents_and_manifest(self):
        result = self.run_backup()
        self.assertTrue(result["verified"])
        self.assertEqual(result["pollCount"], 1)
        self.assertEqual(Path(result["archive"]).stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.archives.stat().st_mode & 0o777, 0o700)
        with tarfile.open(result["archive"], "r:gz") as archive:
            raw = archive.extractfile(f"data/{self.id}.json").read()
            self.assertEqual(json.loads(raw), self.record)
            manifest = json.load(archive.extractfile("manifest.json"))
            self.assertEqual(manifest["files"][f"data/{self.id}.json"], hashlib.sha256(raw).hexdigest())
        self.assertEqual(json.loads(self.document.read_text()), self.record)

    def test_retention_deletes_only_own_archives_at_90_days(self):
        self.archives.mkdir()
        old = self.archives / f"scaletag-data-{(self.now-timedelta(days=90)).strftime(module.STAMP)}.tar.gz"
        recent = self.archives / f"scaletag-data-{(self.now-timedelta(days=90)+timedelta(seconds=1)).strftime(module.STAMP)}.tar.gz"
        unrelated = self.archives / "another-service.tar.gz"
        for path in [old, recent, unrelated]:
            path.write_bytes(b"retention fixture")
        result = self.run_backup()
        self.assertFalse(old.exists())
        self.assertTrue(recent.exists())
        self.assertTrue(unrelated.exists())
        self.assertEqual(result["expiredArchivesRemoved"], 1)

    def test_expired_data_and_non_json_files_are_not_added(self):
        self.record["deleteAt"] = self.now.timestamp() * 1000
        self.document.write_text(json.dumps(self.record))
        (self.data / ".writer.lock").write_text("")
        (self.data / ".env").write_text("DO_NOT_BACK_UP=secret")
        result = self.run_backup()
        self.assertEqual(result["pollCount"], 0)
        with tarfile.open(result["archive"]) as archive:
            self.assertEqual(archive.getnames(), ["manifest.json"])

    def test_invalid_json_does_not_publish_an_archive(self):
        self.document.write_text("{partial")
        with self.assertRaises(ValueError):
            self.run_backup()
        self.assertEqual(list(self.archives.glob("*.tar.gz")), [])
        self.assertEqual(list(self.archives.glob("*.partial")), [])

    def test_symlink_is_not_followed(self):
        target = self.root / "private.json"
        target.write_text(json.dumps(self.record))
        self.document.unlink()
        self.document.symlink_to(target)
        with self.assertRaises(OSError):
            self.run_backup()
        self.assertEqual(list(self.archives.glob("*.tar.gz")), [])

    def test_interrupted_partial_is_cleaned(self):
        self.archives.mkdir()
        partial = self.archives / ".scaletag-backup-interrupted.partial"
        partial.write_bytes(b"interrupted")
        self.run_backup()
        self.assertFalse(partial.exists())

    def test_two_backups_cannot_overlap(self):
        self.archives.mkdir()
        with (self.archives / ".backup.lock").open("w") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaises(BlockingIOError):
                self.run_backup()

    def test_backup_can_run_while_application_writer_lock_is_held(self):
        with (self.data / ".writer.lock").open("w") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.assertTrue(self.run_backup()["verified"])

    def test_low_disk_space_does_not_publish_an_archive(self):
        with patch.object(module.shutil, "disk_usage", return_value=type("Usage", (), {"free": 1})()):
            with self.assertRaises(OSError):
                self.run_backup()
        self.assertEqual(list(self.archives.glob("*.tar.gz")), [])

    def test_checksum_tampering_is_detected(self):
        result = self.run_backup()
        bad = self.root / "tampered.tar.gz"
        with tarfile.open(result["archive"], "r:gz") as source, tarfile.open(bad, "w:gz") as target:
            for member in source:
                raw = source.extractfile(member).read()
                if member.name.startswith("data/"):
                    data = json.loads(raw)
                    data["totalVotes"] = 999
                    raw = json.dumps(data).encode()
                member.size = len(raw)
                target.addfile(member, io.BytesIO(raw))
        with self.assertRaises(ValueError):
            module.verify_archive(bad)


if __name__ == "__main__":
    unittest.main()
