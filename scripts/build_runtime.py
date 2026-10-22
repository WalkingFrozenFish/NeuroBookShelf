"""Build a relocatable, private Python runtime. Run on the destination OS/CPU."""
import hashlib
import json
import os
import platform
import shutil
import subprocess
import tarfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PYTHON_VERSION = "3.11.14"


def run(*args, **kwargs):
    subprocess.run([str(arg) for arg in args], cwd=ROOT, check=True, **kwargs)


def bundle_windows_crt(python_root):
    if os.name != "nt":
        return
    candidates = []
    for variable in ("ProgramFiles", "ProgramFiles(x86)"):
        if os.environ.get(variable):
            base = Path(os.environ[variable]) / "Microsoft Visual Studio"
            candidates.extend(base.glob("*/*/VC/Redist/MSVC/*/x64/Microsoft.VC*.CRT"))
    if not candidates:
        raise RuntimeError("Visual Studio x64 redistributable CRT files are required for packaging")
    crt = max(candidates, key=lambda path: tuple(int(part) for part in path.parent.parent.name.split(".")))
    files = list(crt.glob("*.dll"))
    for openmp in crt.parent.glob("Microsoft.VC*.OpenMP"):
        files.extend(openmp.glob("*.dll"))
    for source in files:
        shutil.copy2(source, python_root / source.name)
    if not (python_root / "msvcp140.dll").is_file():
        raise RuntimeError("Missing app-local MSVCP140.dll")


def main():
    if platform.system() not in ("Windows", "Darwin"):
        raise RuntimeError("Installer runtimes currently support Windows and macOS")
    target = "windows-x64" if os.name == "nt" else "macos-arm64"
    if platform.machine().lower() not in (("amd64", "x86_64") if os.name == "nt" else ("arm64", "aarch64")):
        raise RuntimeError(f"Unsupported architecture for {target}: {platform.machine()}")
    entry = json.loads((ROOT / "scripts/python-distributions.json").read_text(encoding="utf-8"))[target]
    archive = ROOT / ".distribution-cache" / f"python-{target}.tar.gz"
    archive.parent.mkdir(parents=True, exist_ok=True)
    if not archive.is_file():
        with urllib.request.urlopen(entry["url"], timeout=90) as response, archive.open("wb") as output:
            shutil.copyfileobj(response, output)
    if hashlib.sha256(archive.read_bytes()).hexdigest() != entry["sha256"]:
        archive.unlink(missing_ok=True)
        raise RuntimeError("Private Python archive checksum mismatch; retry the build")
    runtime = ROOT / "bundle" / "runtime"
    python_root = runtime / "python"
    runtime.mkdir(parents=True, exist_ok=True)
    if not python_root.exists():
        with tarfile.open(archive) as package:
            # Official archive is SHA256 pinned; still reject absolute/outside members.
            for member in package.getmembers():
                destination = (runtime / member.name).resolve()
                if not destination.is_relative_to(runtime.resolve()):
                    raise RuntimeError("Unsafe Python archive path")
                if member.issym() and not (destination.parent / member.linkname).resolve().is_relative_to(runtime.resolve()):
                    raise RuntimeError("Unsafe Python archive symlink")
            if hasattr(tarfile, "data_filter"):
                package.extractall(runtime, filter="data")
            else:
                package.extractall(runtime)
    python = python_root / ("python.exe" if os.name == "nt" else "bin/python3")
    run(python, "-s", "-m", "ensurepip")
    run(python, "-s", "-m", "pip", "install", "--disable-pip-version-check", "--no-cache-dir", "--only-binary", ":all:", "-r", ROOT / "python-worker/requirements.txt", "-c", ROOT / "python-worker/requirements.lock")
    bundle_windows_crt(python_root)
    for name in ("worker.py", "model_manager.py", "translation_router.py", "model-manifest.json"):
        shutil.copy2(ROOT / "python-worker" / name, runtime / name)
    shutil.copy2(ROOT / "python-worker/requirements.lock", runtime / "requirements.lock")
    run(python, "-s", ROOT / "scripts/collect_licenses.py", runtime)
    run(python, "-s", ROOT / "scripts/smoke_runtime.py", runtime)
    identity = os.environ.get("APPLE_SIGNING_IDENTITY", "").strip() or "-"
    config = {
        "build": {"beforeBundleCommand": "python scripts/sign_runtime.py"},
        "bundle": {
            "resources": {"../bundle/runtime/": "runtime/"},
            "windows": {
                "webviewInstallMode": {"type": "downloadBootstrapper", "silent": True},
                "nsis": {"installMode": "currentUser", "languages": ["Russian", "English"]},
            },
            "macOS": {
                "minimumSystemVersion": "11.0",
                "signingIdentity": identity,
                "hardenedRuntime": identity != "-",
                "entitlements": "entitlements.plist",
            },
        },
    }
    (ROOT / "src-tauri/tauri.release.conf.json").write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    (runtime / "build-info.json").write_text(json.dumps({"python": PYTHON_VERSION, "os": platform.system(), "architecture": platform.machine()}, indent=2), encoding="utf-8")
    print(f"Runtime ready: {runtime}")


if __name__ == "__main__":
    main()
