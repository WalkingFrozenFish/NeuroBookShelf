import json
import re
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
version = json.loads((root / "package.json").read_text(encoding="utf-8"))["version"]
lock = json.loads((root / "package-lock.json").read_text(encoding="utf-8"))
tauri_version = json.loads((root / "src-tauri/tauri.conf.json").read_text(encoding="utf-8"))["version"]
rust_version = re.search(r'^version = "([^"]+)"', (root / "src-tauri/Cargo.toml").read_text(encoding="utf-8"), re.M)[1]
tag = sys.argv[1] if len(sys.argv) > 1 else "v" + version
rust_lock = (root / "src-tauri/Cargo.lock").read_text(encoding="utf-8")
rust_lock_version = re.search(r'\[\[package\]\]\nname = "local-library-reader"\nversion = "([^"]+)"', rust_lock)[1]
if len({version, tauri_version, rust_version, lock["version"], lock["packages"][""]["version"], rust_lock_version}) != 1 or tag != "v" + version:
    raise SystemExit(f"Version mismatch: tag={tag}, npm={version}, tauri={tauri_version}, rust={rust_version}; check both lockfiles")
if len(sys.argv) > 1:
    notes = (root / "RELEASE_NOTES.md").read_text(encoding="utf-8")
    if not notes.startswith(f"# NeuroBookShelf {version}\n"):
        raise SystemExit("Update RELEASE_NOTES.md for the tagged version")
    if not re.fullmatch(r"v\d+\.\d+\.\d+", tag):
        raise SystemExit("This workflow publishes stable vMAJOR.MINOR.PATCH tags only")
print("Release version:", version)
