import json
import re
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
version = json.loads((root / "package.json").read_text(encoding="utf-8"))["version"]
tauri_version = json.loads((root / "src-tauri/tauri.conf.json").read_text(encoding="utf-8"))["version"]
rust_version = re.search(r'^version = "([^"]+)"', (root / "src-tauri/Cargo.toml").read_text(encoding="utf-8"), re.M)[1]
if version != tauri_version or version != rust_version or sys.argv[1] != "v" + version:
    raise SystemExit(f"Version mismatch: tag={sys.argv[1]}, npm={version}, tauri={tauri_version}, rust={rust_version}")
print("Release version:", version)
