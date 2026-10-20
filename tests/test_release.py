"""The release gate must reject incomplete or corrupted downloads before publication."""
import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VERSION = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]


class ReleaseGateTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.directory = Path(self.temporary.name)
        self.windows = [f"NeuroBookShelf_{VERSION}_x64-setup.exe", f"NeuroBookShelf-{VERSION}-windows-x64-portable.zip"]
        self.mac = [f"NeuroBookShelf_{VERSION}_aarch64.dmg"]
        for name in self.windows + self.mac:
            (self.directory / name).write_bytes(("test download " + name).encode())
        for platform, names in (("windows-x64", self.windows), ("macos-arm64", self.mac)):
            (self.directory / f"SHA256SUMS-{platform}.txt").write_text(
                "".join(hashlib.sha256((self.directory / name).read_bytes()).hexdigest() + "  " + name + "\n" for name in names), encoding="utf-8")

    def tearDown(self):
        self.temporary.cleanup()

    def gate(self):
        return subprocess.run([sys.executable, str(ROOT / "scripts/check_release_assets.py"), "--directory", str(self.directory)], capture_output=True, text=True)

    def test_complete_downloads_pass(self):
        result = self.gate()
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_missing_platform_cannot_publish(self):
        (self.directory / self.mac[0]).unlink()
        result = self.gate()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Missing release assets", result.stderr)

    def test_modified_download_cannot_publish(self):
        (self.directory / self.windows[0]).write_bytes(b"corrupted download")
        result = self.gate()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Checksum mismatch", result.stderr)

    def test_duplicate_asset_cannot_shadow_download(self):
        nested = self.directory / "other-platform"
        nested.mkdir()
        (nested / self.windows[0]).write_bytes(b"duplicate")
        result = self.gate()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Duplicate release asset", result.stderr)


if __name__ == "__main__":
    unittest.main()
