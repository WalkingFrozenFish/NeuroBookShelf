import hashlib
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
paths = list((root / "src-tauri/target/release/bundle").rglob("*.dmg"))
paths += list((root / "src-tauri/target/release/bundle/nsis").glob("*.exe"))
paths += list((root / "bundle").glob("*-portable.zip"))
lines = []
for path in paths:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    lines.append(f"{digest.hexdigest()}  {path.name}")
if not lines:
    raise SystemExit("No release files found")
(root / "bundle" / f"SHA256SUMS-{sys.argv[1]}.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
