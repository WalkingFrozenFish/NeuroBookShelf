import hashlib
import json
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
version = json.loads((root / "package.json").read_text(encoding="utf-8"))["version"]
platform = sys.argv[1]
if platform == "windows-x64":
    paths = [root / f"src-tauri/target/release/bundle/nsis/NeuroBookShelf_{version}_x64-setup.exe",
             root / f"bundle/NeuroBookShelf-{version}-windows-x64-portable.zip"]
elif platform == "macos-arm64":
    paths = [root / f"src-tauri/target/release/bundle/dmg/NeuroBookShelf_{version}_aarch64.dmg"]
else:
    raise SystemExit("Unsupported release platform: " + platform)
lines = []
for path in paths:
    if not path.is_file():
        raise SystemExit("Missing package for current version: " + path.name)
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    lines.append(f"{digest.hexdigest()}  {path.name}")
if not lines:
    raise SystemExit("No release files found")
(root / "bundle" / f"SHA256SUMS-{sys.argv[1]}.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
