"""Refuse publication unless installers and checksums for both platforms exist."""
import json
import hashlib
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
directory = Path(sys.argv[2]) if sys.argv[1] == "--directory" else None
if directory:
    paths = list(directory.rglob("*"))
    files = {p.name: p for p in paths if p.is_file()}
    if len(files) != sum(p.is_file() for p in paths):
        raise SystemExit("Duplicate release asset filenames")
    assets = set(files)
else:
    assets = set(Path(sys.argv[1]).read_text(encoding="utf-8").splitlines())
missing = required - assets
if missing:
    raise SystemExit("Missing release assets: " + ", ".join(sorted(missing)))
if directory:
    verified = set()
    for name in required:
        if files[name].stat().st_size == 0:
            raise SystemExit("Empty release asset: " + name)
        if not name.startswith("SHA256SUMS-"):
            continue
        for line in files[name].read_text(encoding="utf-8").splitlines():
            expected, filename = line.split("  ", 1)
            if filename not in files or filename not in required or filename.startswith("SHA256SUMS-"):
                raise SystemExit("Unexpected checksum target: " + filename)
            digest = hashlib.sha256()
            with files[filename].open("rb") as source:
                for chunk in iter(lambda: source.read(1024 * 1024), b""):
                    digest.update(chunk)
            if digest.hexdigest() != expected:
                raise SystemExit("Checksum mismatch: " + filename)
            verified.add(filename)
    if verified != {name for name in required if not name.startswith("SHA256SUMS-")}:
        raise SystemExit("Checksums do not cover every installer")
    if len(sys.argv) > 3:
        if len(sys.argv) != 5 or sys.argv[3] != "--write-upload-list":
            raise SystemExit("Expected --write-upload-list PATH")
        Path(sys.argv[4]).write_text("".join(str(files[name]) + "\n" for name in sorted(required)), encoding="utf-8")
print("All Windows and macOS release assets are present")
