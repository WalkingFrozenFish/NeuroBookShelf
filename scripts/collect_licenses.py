"""Preserve available upstream notices and declared licenses in packaged runtimes."""
import importlib.metadata
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = Path(sys.argv[1]).resolve()
OUTPUT = RUNTIME / "licenses"
OUTPUT.mkdir(parents=True, exist_ok=True)
records = []


def safe_name(value):
    return re.sub(r"[^A-Za-z0-9_.-]", "_", value)


def is_notice(path):
    return path.name.lower().startswith(("license", "licence", "copying", "copyright", "notice", "authors"))


def preserve(source, destination):
    if source.is_file():
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)


for name in ("LICENSE", "THIRD_PARTY_NOTICES.md"):
    preserve(ROOT / name, OUTPUT / name)
for source in (ROOT / "licenses").rglob("*"):
    if source.is_file():
        preserve(source, OUTPUT / "models" / source.relative_to(ROOT / "licenses"))

python_root = (RUNTIME / "python").resolve()
if not Path(sys.executable).resolve().is_relative_to(python_root):
    raise SystemExit("Run this script with the packaged Python interpreter")
for distribution in importlib.metadata.distributions():
    name = distribution.metadata.get("Name", "unknown")
    version = distribution.version
    classifiers = [value for value in distribution.metadata.get_all("Classifier", []) if value.startswith("License ::")]
    records.append({"ecosystem": "python", "name": name, "version": version,
                    "license": distribution.metadata.get("License-Expression") or distribution.metadata.get("License") or "; ".join(classifiers) or "NOT DECLARED",
                    "licenseFiles": distribution.metadata.get_all("License-File", []),
                    "projectUrls": distribution.metadata.get_all("Project-URL", [])})
    for entry in distribution.files or []:
        path = Path(entry)
        if is_notice(path) or "licenses" in path.parts:
            source = Path(distribution.locate_file(entry)).resolve()
            if source.is_relative_to(python_root):
                preserve(source, OUTPUT / "python" / safe_name(name + "-" + version) / source.relative_to(python_root))

lock = json.loads((ROOT / "package-lock.json").read_text(encoding="utf-8"))
for location, item in lock["packages"].items():
    if not location or item.get("dev"):
        continue
    package = ROOT / location
    if not package.is_dir():
        continue  # optional dependency for another operating system
    metadata = json.loads((package / "package.json").read_text(encoding="utf-8"))
    name, version = metadata["name"], metadata["version"]
    records.append({"ecosystem": "npm", "name": name, "version": version, "license": metadata.get("license", "NOT DECLARED"), "repository": metadata.get("repository")})
    for source in package.iterdir():
        if is_notice(source):
            if source.is_file():
                preserve(source, OUTPUT / "npm" / safe_name(name + "-" + version) / source.name)
            elif source.is_dir():
                for child in source.rglob("*"):
                    preserve(child, OUTPUT / "npm" / safe_name(name + "-" + version) / child.relative_to(package))

host = subprocess.run(["rustc", "-vV"], capture_output=True, text=True, check=True).stdout
host = next(line.split(": ", 1)[1] for line in host.splitlines() if line.startswith("host: "))
metadata = subprocess.run(["cargo", "metadata", "--locked", "--filter-platform", host, "--format-version", "1", "--manifest-path", str(ROOT / "src-tauri/Cargo.toml")], capture_output=True, text=True, encoding="utf-8")
if metadata.returncode:
    raise SystemExit(metadata.stderr)
for package in json.loads(metadata.stdout)["packages"]:
    name, version = package["name"], package["version"]
    records.append({"ecosystem": "cargo", "name": name, "version": version, "license": package.get("license") or "NOT DECLARED", "repository": package.get("repository")})
    directory = Path(package["manifest_path"]).parent
    if directory == ROOT / "src-tauri":
        continue
    for source in directory.rglob("*"):
        if source.is_file() and (is_notice(source) or source.relative_to(directory).as_posix() == package.get("license_file")):
            preserve(source, OUTPUT / "cargo" / safe_name(name + "-" + version) / source.relative_to(directory))

records.sort(key=lambda item: (item["ecosystem"], item["name"].lower()))
(OUTPUT / "inventory.json").write_text(json.dumps(records, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
revision = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
(OUTPUT / "SOURCE.txt").write_text(
    "NeuroBookShelf: AGPL-3.0-only\n"
    f"Corresponding application source: https://github.com/WalkingFrozenFish/NeuroBookShelf/tree/{revision}\n"
    f"Source archive: https://github.com/WalkingFrozenFish/NeuroBookShelf/archive/{revision}.zip\n"
    "Build instructions: SETUP.md and DISTRIBUTION.md in the source archive.\n"
    "Third-party components retain their own licenses. See inventory.json and preserved notices.\n",
    encoding="utf-8",
)
unknown = [item for item in records if item["license"] in ("NOT DECLARED", "UNKNOWN")]
print(f"Preserved upstream notices for {len(records)} packages; {len(unknown)} have no declared license. Review inventory.json when updating dependencies.")
