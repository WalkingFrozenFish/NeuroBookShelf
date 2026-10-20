"""Verify first-run downloads, translation and OCR with the private runtime."""
import json
import os
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parents[1]
runtime = root / "bundle/runtime"
python = runtime / ("python/python.exe" if os.name == "nt" else "python/bin/python3")
models = root / ".distribution-cache/models-integration"
models.mkdir(parents=True, exist_ok=True)
fixture = models.parent / "ocr-integration.pdf"
subprocess.run([str(python), "-s", "-c", "import pymupdf,sys;d=pymupdf.open();p=d.new_page(width=400,height=200);p.insert_text((40,70),'Hello OCR',fontsize=30);d.save(sys.argv[1])", str(fixture)], check=True)
environment = dict(os.environ, LLR_MODEL_ROOT=str(models), LLR_BUNDLED_RUNTIME="1", PYTHONNOUSERSITE="1")
environment.pop("PYTHONHOME", None)
environment.pop("PYTHONPATH", None)
requests = [
    {"command": "install_models"},
    {"command": "translate", "payload": {"text": "Hello", "sourceLanguage": "en", "targetLanguage": "ru"}},
    {"command": "ocr_page", "payload": {"pdfPath": str(fixture), "pageNumber": 1}},
]
process = subprocess.run([str(python), "-s", "-u", str(runtime / "worker.py")], input="".join(json.dumps(request) + "\n" for request in requests), text=True, encoding="utf-8", capture_output=True, env=environment, timeout=900)
responses = [json.loads(line) for line in process.stdout.splitlines() if line.strip()]
assert process.returncode == 0 and len(responses) == 3, process.stderr[-3000:]
assert all(response["success"] for response in responses), responses
assert "привет" in responses[1]["result"]["translatedText"].lower(), responses[1]
assert any("Hello OCR" in block["text"] for block in responses[2]["result"]["blocks"]), responses[2]
manifest = json.loads((runtime / "model-manifest.json").read_text(encoding="utf-8"))
for group in manifest["groups"]:
    for name in group.get("required", [entry["name"] for entry in group.get("files", [])]):
        assert (models / group["target"] / name).is_file(), f"Missing installed model file or attribution: {name}"
print("Verified model download, translation and OCR with packaged Python")
