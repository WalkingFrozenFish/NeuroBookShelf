"""Pinned model downloads. No pip, shell commands, or executable downloads at runtime."""

import hashlib
import json
import os
import shutil
import ssl
import time
import urllib.request
import zipfile
import re
from urllib.parse import urlparse
from pathlib import Path


def model_root():
    return Path(os.environ.get("LLR_MODEL_ROOT", Path(__file__).parent / "models"))


CATALOG_URL = "https://raw.githubusercontent.com/argosopentech/argospm-index/main/index.json"
MODEL_HOSTS = {"argos-net.com", "data.argosopentech.com"}
MAX_DOWNLOAD = 1024 * 1024 * 1024


def bundled_manifest():
    return json.loads(Path(__file__).with_name("model-manifest.json").read_text(encoding="utf-8"))


def manifest():
    bundled = bundled_manifest()
    groups = {group["target"]: group for group in bundled["groups"]}
    try:
        cached = json.loads((model_root() / "catalog.json").read_text(encoding="utf-8"))
        for group in normalize_catalog(cached["packages"]):
            groups[group["target"]] = group
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return {"version": bundled["version"], "groups": list(groups.values())}


def valid_pair(pair):
    return isinstance(pair, str) and re.fullmatch(r"[a-z]{2,3}-[a-z]{2,3}", pair) is not None


def trusted_model_url(url):
    try:
        parsed = urlparse(url)
        return (parsed.scheme == "https" and parsed.hostname in MODEL_HOSTS
                and not parsed.username and not parsed.password and parsed.port in (None, 443)
                and parsed.path.endswith(".argosmodel"))
    except ValueError:
        return False


def normalize_catalog(packages):
    if not isinstance(packages, list) or len(packages) > 2000:
        raise ValueError("Invalid model catalog")
    groups = {}
    pinned = {g["target"]: g for g in bundled_manifest()["groups"] if "archive" in g}
    for package in packages:
        if not isinstance(package, dict) or package.get("type", "translate") != "translate":
            continue
        source, target = package.get("from_code", ""), package.get("to_code", "")
        pair = f"{source}-{target}"
        version = package.get("package_version", "")
        if not valid_pair(pair) or source == target or not isinstance(version, str) or not re.fullmatch(r"\d+(?:\.\d+){0,3}", version):
            continue
        urls = [url for url in package.get("links", []) if isinstance(url, str) and trusted_model_url(url)]
        if not urls:
            continue
        previous = groups.get(pair)
        if previous and tuple(map(int, previous["packageVersion"].split("."))) >= tuple(map(int, version.split("."))):
            continue
        entry = {"url": urls[0], "name": Path(urlparse(urls[0]).path).name, "urls": urls}
        if pair in pinned and pinned[pair]["archive"]["name"] == entry["name"]:
            entry.update({key: pinned[pair]["archive"][key] for key in ("size", "sha256")})
        groups[pair] = {
            "id": f"translation-{pair}", "target": pair, "name": "Argos Translate",
            "source": source, "targetLanguage": target,
            "sourceName": str(package.get("from_name") or source)[:100],
            "targetName": str(package.get("to_name") or target)[:100],
            "packageVersion": version, "archive": entry,
            "required": ["model.bin", "config.json", "sentencepiece.model", "metadata.json"],
            "remote": True,
        }
    return list(groups.values())


def refresh_catalog():
    try:
        request = urllib.request.Request(CATALOG_URL, headers={"User-Agent": "NeuroBookShelf/0.1"})
        with urllib.request.urlopen(request, context=tls_context(), timeout=15) as response:
            if not response.url.startswith("https://raw.githubusercontent.com/"):
                raise ValueError("Unexpected catalog redirect")
            raw = response.read(2 * 1024 * 1024 + 1)
        if len(raw) > 2 * 1024 * 1024:
            raise ValueError("Model catalog is too large")
        packages = json.loads(raw)
        groups = normalize_catalog(packages)
        if not groups:
            raise ValueError("No compatible translation packages in catalog")
        atomic_json(model_root() / "catalog.json", {"packages": packages, "groups": groups, "updatedAt": time.time()})
        return {"success": True, "result": {"count": len(groups)}}
    except Exception as exc:
        return {"success": False, "error": {"code": "CATALOG_UNAVAILABLE", "message": str(exc)[:400]}}


def tls_context():
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
    temporary.replace(path)


def progress(**value):
    atomic_json(model_root() / "download-progress.json", {**value, "pair": _download_pair, "updatedAt": time.time()})


def file_hash(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


class DownloadCancelled(Exception):
    pass


_download_pair = None


def check_cancelled():
    if (model_root() / "cancel-download").exists():
        raise DownloadCancelled("Download cancelled")


def active_pair():
    try:
        pair = json.loads((model_root() / "translation-choice.json").read_text(encoding="utf-8"))["pair"]
    except (OSError, ValueError, KeyError, TypeError):
        return "en-ru"
    return pair if any(g.get("target") == pair and g.get("archive") for g in manifest()["groups"]) else "en-ru"


def translation_settings():
    try:
        value = json.loads((model_root() / "translation-choice.json").read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        value = {}
    if not isinstance(value, dict):
        value = {}
    pair = value.get("pair")
    target = value.get("targetLanguage") or (pair.split("-")[-1] if valid_pair(pair) else "ru")
    source = value.get("sourceLanguage", "auto")
    return {"sourceLanguage": source if source == "auto" or re.fullmatch(r"[a-z]{2,3}", str(source)) else "auto",
            "targetLanguage": target if re.fullmatch(r"[a-z]{2,3}", str(target)) else "ru"}


def translation_directory(pair):
    if not valid_pair(pair):
        raise ValueError("Invalid translation pair")
    override = os.environ.get("LLR_TRANSLATION_MODEL", "").strip()
    if override and pair == "en-ru":
        return Path(override)
    root = model_root() / pair
    if (root / "model.bin").is_file() or os.environ.get("LLR_BUNDLED_RUNTIME"):
        return root
    development = Path(__file__).parent / "models" / pair
    return development if (development / "model.bin").is_file() else root


def installed_pairs():
    pairs = {g["target"] for g in manifest()["groups"] if g.get("archive")}
    if model_root().exists():
        pairs.update(p.name for p in model_root().iterdir() if p.is_dir() and valid_pair(p.name))
    return sorted(pair for pair in pairs if all((translation_directory(pair) / name).is_file()
                  for name in ("model.bin", "sentencepiece.model")))


def download(entry, directory, completed, total):
    check_cancelled()
    directory.mkdir(parents=True, exist_ok=True)
    destination = directory / entry["name"]
    digest_file = destination.with_suffix(destination.suffix + ".sha256")
    expected_hash = entry.get("sha256")
    if not expected_hash and digest_file.is_file():
        expected_hash = digest_file.read_text(encoding="ascii").strip()
    if destination.is_file() and expected_hash and file_hash(destination) == expected_hash:
        return destination
    if not entry["url"].startswith("https://"):
        raise ValueError("Model source must use HTTPS")
    temporary = destination.with_suffix(destination.suffix + ".part")
    context = tls_context()
    request = urllib.request.Request(entry["url"], headers={"User-Agent": "NeuroBookShelf/0.1"})
    digest = hashlib.sha256()
    received = 0
    with urllib.request.urlopen(request, context=context, timeout=10) as response, temporary.open("wb") as output:
        if not response.url.startswith("https://"):
            raise ValueError("Insecure model redirect")
        read_chunk = getattr(response, "read1", response.read)
        response_size = int(response.headers.get("Content-Length", "0")) if hasattr(response, "headers") else 0
        expected_size = entry.get("size") or response_size
        while chunk := read_chunk(64 * 1024):
            check_cancelled()
            received += len(chunk)
            if received > MAX_DOWNLOAD or (expected_size and received > expected_size):
                raise ValueError("Downloaded model exceeds expected size")
            output.write(chunk)
            digest.update(chunk)
            progress(phase="downloading", file=entry["name"], downloaded=completed + received, total=total or expected_size)
    check_cancelled()
    if (expected_size and received != expected_size) or (entry.get("sha256") and digest.hexdigest() != entry["sha256"]):
        temporary.unlink(missing_ok=True)
        raise ValueError("Model checksum mismatch; retry the download")
    temporary.replace(destination)
    digest_file.write_text(digest.hexdigest(), encoding="ascii")
    return destination


def install_models(pair=None):
    global _download_pair
    root = model_root()
    requested_pair = pair
    pair = pair or active_pair()
    _download_pair = pair
    if pair != "ocr" and not valid_pair(pair):
        return {"success": False, "error": {"code": "UNSUPPORTED_LANGUAGE", "message": "Unknown translation model"}}
    groups = [g for g in manifest()["groups"] if g.get("target") == pair or (not g.get("archive") and (requested_pair is None or pair == "ocr"))]
    if requested_pair is not None and pair != "ocr" and not any(g.get("target") == pair for g in groups):
        return {"success": False, "error": {"code": "UNSUPPORTED_LANGUAGE", "message": "Unknown translation model"}}
    total = sum(entry.get("size", 0) for group in groups for entry in group.get("files", [group.get("archive")]))
    completed = 0
    try:
        for group in groups:
            check_cancelled()
            target = root / group["target"]
            entries = group.get("files", [group.get("archive")])
            expected = group.get("required", [entry["name"] for entry in entries])
            marker = target / "ready.json"
            if marker.is_file() and all((target / name).is_file() for name in expected):
                completed += sum(entry.get("size", 0) for entry in entries)
                continue
            staging = root / ".staging" / group["id"]
            staging.mkdir(parents=True, exist_ok=True)
            for entry in entries:
                failures = []
                for url in entry.get("urls", [entry["url"]]):
                    try:
                        source = download({**entry, "url": url}, root / ".downloads", completed, total)
                        break
                    except DownloadCancelled:
                        raise
                    except Exception as exc:
                        failures.append(str(exc))
                else:
                    raise ValueError("; ".join(failures))
                completed += source.stat().st_size
                if "archive" in group:
                    progress(phase="extracting", file=group.get("name", group["id"]), downloaded=completed, total=total)
                    # Copy only explicitly required basenames; never extract paths supplied by a ZIP.
                    with zipfile.ZipFile(source) as archive:
                        if group.get("remote"):
                            metadata_entries = [info for info in archive.infolist() if Path(info.filename).name == "metadata.json" and not info.is_dir()]
                            if len(metadata_entries) != 1 or metadata_entries[0].file_size > 1024 * 1024:
                                raise ValueError("Invalid package metadata")
                            metadata = json.loads(archive.read(metadata_entries[0]))
                            if (f"{metadata.get('from_code')}-{metadata.get('to_code')}" != pair
                                    or metadata.get("package_version") != group["packageVersion"]
                                    or metadata.get("target_prefix")):
                                raise ValueError("Package languages, version or tokenizer are incompatible")
                            expected = ["model.bin", "config.json", "sentencepiece.model", "metadata.json"]
                            expected += [name for name in ("shared_vocabulary.json", "source_vocabulary.json", "target_vocabulary.json", "README.md")
                                         if any(Path(info.filename).name == name for info in archive.infolist())]
                            if sum(info.file_size for info in archive.infolist() if Path(info.filename).name in expected) > 2 * MAX_DOWNLOAD:
                                raise ValueError("Expanded model is too large")
                        for name in expected:
                            check_cancelled()
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
            atomic_json(marker, {"manifestVersion": manifest()["version"], "files": expected,
                                 "packageVersion": group.get("packageVersion", ""), "pair": group["target"]})
        check_cancelled()
        progress(phase="ready", downloaded=completed, total=completed)
        return {"success": True, "result": {"ready": True}}
    except DownloadCancelled:
        for partial in (root / ".downloads").glob("*.part"):
            partial.unlink(missing_ok=True)
        progress(phase="cancelled", downloaded=completed, total=total)
        return {"success": False, "error": {"code": "DOWNLOAD_CANCELLED", "message": "Download cancelled"}}
    except Exception as exc:
        if (root / "cancel-download").exists():
            progress(phase="cancelled", downloaded=completed, total=total)
            return {"success": False, "error": {"code": "DOWNLOAD_CANCELLED", "message": "Download cancelled"}}
        progress(phase="error", message=str(exc)[:400], downloaded=completed, total=total)
        return {"success": False, "error": {"code": "MODEL_DOWNLOAD_FAILED", "message": str(exc)[:400]}}
