"""Sign nested Mach-O files before Tauri copies the runtime into its app bundle."""
import os
import subprocess
import sys
from pathlib import Path

if sys.platform != "darwin":
    raise SystemExit(0)
root = Path(__file__).resolve().parents[1]
identity = os.environ.get("APPLE_SIGNING_IDENTITY", "").strip() or "-"
magic = {b"\xfe\xed\xfa\xce", b"\xce\xfa\xed\xfe", b"\xfe\xed\xfa\xcf", b"\xcf\xfa\xed\xfe", b"\xca\xfe\xba\xbe", b"\xbe\xba\xfe\xca"}
for path in sorted((root / "bundle/runtime").rglob("*"), key=lambda item: len(item.parts), reverse=True):
    if not path.is_file() or path.is_symlink():
        continue
    with path.open("rb") as source:
        if source.read(4) not in magic:
            continue
    args = ["codesign", "--force", "--sign", identity]
    if identity != "-":
        args += ["--options", "runtime", "--timestamp", "--entitlements", str(root / "src-tauri/entitlements.plist")]
    subprocess.run(args + [str(path)], check=True)
print("Nested Python binaries signed")
