"""Run real offline multilingual inference using already installed test models."""
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
python = ROOT / "bundle/runtime" / ("python/python.exe" if os.name == "nt" else "python/bin/python3")
models = ROOT / ".distribution-cache/languages-integration"
english = "This book explains how to read a document and translate its pages."
french = "Ce livre explique comment lire un document et traduire ses pages."
russian = "Этот русский абзац должен остаться без изменений."
mixed = "\n\n".join([english, french, russian])
requests = [
    {"command": "translate", "payload": {"text": mixed, "sourceLanguage": "auto", "targetLanguage": "ru"}},
    {"command": "translate", "payload": {"text": mixed, "sourceLanguage": "auto", "targetLanguage": "en"}},
    {"command": "translate", "payload": {"text": russian, "sourceLanguage": "auto", "targetLanguage": "ru"}},
    {"command": "translate", "payload": {"text": "Dies ist ein deutscher Absatz über das Lesen von Büchern und das Übersetzen von Texten.", "sourceLanguage": "auto", "targetLanguage": "ru"}},
    {"command": "translate", "payload": {"text": english + " " + french + " " + russian, "sourceLanguage": "auto", "targetLanguage": "ru"}},
]
environment = dict(os.environ, LLR_MODEL_ROOT=str(models), LLR_BUNDLED_RUNTIME="1", PYTHONNOUSERSITE="1")
environment.pop("PYTHONHOME", None)
environment.pop("PYTHONPATH", None)
process = subprocess.run([str(python), "-s", "-u", str(ROOT / "python-worker/worker.py")],
                         input="".join(json.dumps(request) + "\n" for request in requests), text=True,
                         encoding="utf-8", capture_output=True, env=environment, timeout=180)
responses = [json.loads(line) for line in process.stdout.splitlines() if line.strip()]
assert process.returncode == 0 and len(responses) == len(requests), process.stderr[-3000:]
for index in (0, 1, 2, 4):
    assert responses[index]["success"], responses[index]
first, second, identity = [responses[index]["result"] for index in (0, 1, 2)]
assert set(first["sourceLanguages"]) == {"en", "fr", "ru"}, first
assert first["routes"]["fr"] == ["fr-en", "en-ru"], first
assert first["translatedText"].split("\n\n")[-1] == russian, first
assert second["routes"]["en"] == [] and second["routes"]["fr"] == ["fr-en"], second
assert second["translatedText"].split("\n\n")[0] == english, second
assert identity["alreadyTarget"] and identity["translatedText"] == russian, identity
assert responses[3]["error"]["code"] == "MODEL_MISSING", responses[3]
assert "de-en" in responses[3]["error"]["message"], responses[3]
assert set(responses[4]["result"]["sourceLanguages"]) == {"en", "fr", "ru"}, responses[4]
print(json.dumps({"mixedBook": first, "inlineMixed": responses[4]["result"], "missingModel": responses[3]}, ensure_ascii=True))
print("Multilingual inference passed: auto detection, inline language changes, direct/pivot routes, unchanged target text, missing models")
