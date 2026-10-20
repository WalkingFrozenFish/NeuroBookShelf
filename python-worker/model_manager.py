"""Pinned model downloads. No pip, shell commands, or executable downloads at runtime."""

import hashlib
import json
import os
import shutil
import ssl
import time
import urllib.request
import zipfile
from pathlib import Path


def model_root():
    return Path(os.environ.get("LLR_MODEL_ROOT", Path(__file__).parent / "models"))


def manifest():
    return json.loads(Path(__file__).with_name("model-manifest.json").read_text(encoding="utf-8"))


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
    temporary.replace(path)


def progress(**value):
    atomic_json(model_root() / "download-progress.json", {**value, "updatedAt": time.time()})


def file_hash(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download(entry, directory, completed, total):
    directory.mkdir(parents=True, exist_ok=True)
    destination = directory / entry["name"]
    if destination.is_file() and file_hash(destination) == entry["sha256"]:
        return destination
    if not entry["url"].startswith("https://"):
        raise ValueError("Model source must use HTTPS")
    temporary = destination.with_suffix(destination.suffix + ".part")
    try:
        import certifi
        context = ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        context = ssl.create_default_context()
    request = urllib.request.Request(entry["url"], headers={"User-Agent": "NeuroBookShelf/0.1"})
    digest = hashlib.sha256()
    received = 0
    with urllib.request.urlopen(request, context=context, timeout=60) as response, temporary.open("wb") as output:
        if not response.url.startswith("https://"):
            raise ValueError("Insecure model redirect")
        while chunk := response.read(256 * 1024):
            received += len(chunk)
            if received > entry["size"]:
                raise ValueError("Downloaded model exceeds expected size")
            output.write(chunk)
            digest.update(chunk)
            progress(phase="downloading", file=entry["name"], downloaded=completed + received, total=total)
    if received != entry["size"] or digest.hexdigest() != entry["sha256"]:
        temporary.unlink(missing_ok=True)
        raise ValueError("Model checksum mismatch; retry the download")
    temporary.replace(destination)
    return destination


def install_models():
    root = model_root()
    groups = manifest()["groups"]
    total = sum(entry["size"] for group in groups for entry in group.get("files", [group.get("archive")]))
    completed = 0
    try:
        for group in groups:
            target = root / group["target"]
            entries = group.get("files", [group.get("archive")])
            expected = group.get("required", [entry["name"] for entry in entries])
            marker = target / "ready.json"
            if marker.is_file() and all((target / name).is_file() for name in expected):
                completed += sum(entry["size"] for entry in entries)
                continue
            staging = root / ".staging" / group["id"]
            staging.mkdir(parents=True, exist_ok=True)
            for entry in entries:
                source = download(entry, root / ".downloads", completed, total)
                completed += entry["size"]
                if "archive" in group:
                    progress(phase="extracting", file=group.get("name", group["id"]), downloaded=completed, total=total)
                    # Copy only explicitly required basenames; never extract paths supplied by a ZIP.
                    with zipfile.ZipFile(source) as archive:
                        for name in expected:
                            candidates = [info for info in archive.infolist() if not info.is_dir() and Path(info.filename).name == name]
                            if len(candidates) != 1:
                                raise ValueError(f"Model archive is missing or duplicates {name}")
                            if candidates[0].file_size > 1024 * 1024 * 1024:
                                raise ValueError("Model archive entry is too large")
                            with archive.open(candidates[0]) as incoming, (staging / name).open("wb") as output:
                                shutil.copyfileobj(incoming, output)
                else:
                    shutil.copyfile(source, staging / entry["name"])
            target.mkdir(parents=True, exist_ok=True)
            for name in expected:
                (staging / name).replace(target / name)
            atomic_json(marker, {"manifestVersion": manifest()["version"], "files": expected})
        progress(phase="ready", downloaded=total, total=total)
        return {"success": True, "result": {"ready": True}}
    except Exception as exc:
        progress(phase="error", message=str(exc)[:400], downloaded=completed, total=total)
        return {"success": False, "error": {"code": "MODEL_DOWNLOAD_FAILED", "message": str(exc)[:400]}}
