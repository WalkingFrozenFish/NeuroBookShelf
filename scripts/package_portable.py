"""Create Windows portable ZIP; the marker opts into local user-data storage."""
import json
import shutil
from pathlib import Path

root = Path(__file__).resolve().parents[1]
version = json.loads((root / "package.json").read_text(encoding="utf-8"))["version"]
destination = root / "bundle" / f"NeuroBookShelf-{version}-windows-x64-portable"
destination.mkdir(parents=True, exist_ok=False)
shutil.copy2(root / "src-tauri/target/release/local-library-reader.exe", destination / "NeuroBookShelf.exe")
shutil.copytree(root / "bundle/runtime", destination / "runtime")
(destination / "portable.flag").write_text("Store library and models in user-data next to this file.\n", encoding="utf-8")
shutil.make_archive(str(destination), "zip", root_dir=destination)
print(str(destination) + ".zip")
