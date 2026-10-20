"""Smoke-test the JSON worker using its private interpreter, without system Python."""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

runtime = Path(sys.argv[1]).resolve()
python = runtime / ("python/python.exe" if os.name == "nt" else "python/bin/python3")
environment = dict(os.environ)
environment.pop("PYTHONHOME", None)
environment.pop("PYTHONPATH", None)
environment["PYTHONNOUSERSITE"] = "1"
environment["PYTHONDONTWRITEBYTECODE"] = "1"
subprocess.run([str(python), "-s", "-c", "import pymupdf, paddle, paddleocr, ctranslate2, sentencepiece, lingua; print('Packaged Python imports OK')"], env=environment, check=True)
with tempfile.TemporaryDirectory(prefix="llr-runtime-") as directory:
    fixture = Path(directory) / "sample.pdf"
    subprocess.run([str(python), "-s", "-c", "import pymupdf,sys; d=pymupdf.open(); p=d.new_page(); p.insert_text((72,72),'Hello packaged worker'); d.save(sys.argv[1])", str(fixture)], env=environment, check=True)
    requests = [{"command": "ping"}, {"command": "analyze_page", "payload": {"path": str(fixture), "pageNumber": 1}}]
    result = subprocess.run([str(python), "-s", "-u", str(runtime / "worker.py")], input="".join(json.dumps(request) + "\n" for request in requests), text=True, encoding="utf-8", capture_output=True, env=environment, timeout=90, check=True)
    responses = [json.loads(line) for line in result.stdout.splitlines() if line.strip()]
    assert len(responses) == 2, result.stderr
    assert responses[0] == {"success": True, "result": "pong"}, responses
    assert responses[1]["success"] and responses[1]["result"]["hasTextLayer"], responses
    assert any("Hello packaged worker" in block["text"] for block in responses[1]["result"]["blocks"]), responses
print("Private runtime JSON/PDF smoke test passed")
