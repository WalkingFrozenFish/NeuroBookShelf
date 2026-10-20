"""Refuse publication unless installers and checksums for both platforms exist."""
import json
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
version = json.loads((root / "package.json").read_text(encoding="utf-8"))["version"]
required = {
    f"NeuroBookShelf_{version}_x64-setup.exe",
    f"NeuroBookShelf-{version}-windows-x64-portable.zip",
    f"NeuroBookShelf_{version}_aarch64.dmg",
    "SHA256SUMS-windows-x64.txt",
    "SHA256SUMS-macos-arm64.txt",
}
assets = set(Path(sys.argv[1]).read_text(encoding="utf-8").splitlines())
missing = required - assets
if missing:
    raise SystemExit("Missing release assets: " + ", ".join(sorted(missing)))
print("All Windows and macOS release assets are present")
