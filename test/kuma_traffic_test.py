import importlib.util
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

path = Path(__file__).resolve().parents[1] / "deploy" / "kuma_traffic.py"
spec = importlib.util.spec_from_file_location("kuma_traffic", path)
kuma = importlib.util.module_from_spec(spec)
spec.loader.exec_module(kuma)

COLLECTOR = """import urllib.parse
status, msg, ping = 'down', 'readiness unavailable', 12
url = urllib.parse.urlencode({'status': status, 'msg': msg, 'ping': ping})
"""
SAMPLE = {
    "days7": {"visits": 10, "created": {"polls": 1, "tasks": 2, "giveaways": 3, "secrex": 4}},
    "days30": {"visits": 50, "created": {"polls": 5, "tasks": 6, "giveaways": 7, "secrex": 8}},
}


class KumaTrafficTests(unittest.TestCase):
    def test_appends_both_windows_and_fails_open(self):
        with patch.object(kuma, "read_stats", return_value=SAMPLE):
            self.assertEqual(kuma.with_traffic("ready", 3000),
                "ready | 7d: visits=10 polls=1 tasks=2 giveaways=3 secrex=4 | "
                "30d: visits=50 polls=5 tasks=6 giveaways=7 secrex=8")
            self.assertEqual(kuma.with_traffic("x" * 240, 3000), "x" * 240)
        with patch.object(kuma, "read_stats", side_effect=TimeoutError):
            self.assertEqual(kuma.with_traffic("readiness unavailable", 3000), "readiness unavailable")
        with patch.object(kuma, "read_stats", return_value={"days7": {}}):
            self.assertEqual(kuma.with_traffic("ready", 3000), "ready")

    def test_install_is_idempotent_and_preserves_health_fields(self):
        with TemporaryDirectory() as directory:
            collector = Path(directory) / "healthcheck.py"
            collector.write_text(COLLECTOR)
            kuma.install(collector, 3000, path.read_bytes())
            first = collector.read_text()
            kuma.install(collector, 3000, path.read_bytes())
            self.assertEqual(collector.read_text(), first)
            self.assertIn("'status': status", first)
            self.assertIn("'ping': ping", first)
            self.assertIn("scaletag_with_traffic(msg, 3000)", first)
            kuma.install(collector, 3001, path.read_bytes())
            self.assertIn("scaletag_with_traffic(msg, 3001)", collector.read_text())
            self.assertEqual(collector.read_text().count("from scaletag_kuma_traffic import"), 1)

    def test_unknown_collector_is_preserved(self):
        with TemporaryDirectory() as directory:
            collector = Path(directory) / "healthcheck.py"
            collector.write_text("print('unknown format')\n")
            with self.assertRaises(ValueError):
                kuma.install(collector, 3000, path.read_bytes())
            self.assertEqual(collector.read_text(), "print('unknown format')\n")
            self.assertEqual(len(list(Path(directory).iterdir())), 1)
