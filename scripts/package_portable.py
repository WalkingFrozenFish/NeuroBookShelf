"""Create Windows portable ZIP; the marker opts into local user-data storage."""
import json
import shutil
import zipfile
from pathlib import Path


def create_archive(directory):
    # Upstream notices can use Unix-epoch dates. ZIP timestamps start in 1980;
    # clamp archive metadata without changing the files or their contents.
    archive = Path(str(directory) + ".zip")
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, strict_timestamps=False) as output:
        for source in sorted(directory.rglob("*")):
            output.write(source, source.relative_to(directory))
    return archive


def main():
    root = Path(__file__).resolve().parents[1]
    version = json.loads((root / "package.json").read_text(encoding="utf-8"))["version"]
    destination = root / "bundle" / f"NeuroBookShelf-{version}-windows-x64-portable"
    destination.mkdir(parents=True, exist_ok=False)
    shutil.copy2(root / "src-tauri/target/release/local-library-reader.exe", destination / "NeuroBookShelf.exe")
    shutil.copytree(root / "bundle/runtime", destination / "runtime")
    (destination / "portable.flag").write_text("Store library and models in user-data next to this file.\n", encoding="utf-8")
    print(create_archive(destination))


if __name__ == "__main__":
    main()
