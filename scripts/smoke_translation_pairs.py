"""Exercise installed language pairs with the packaged Python runtime.

Optional --download installs the pinned models first (roughly 500 MiB total).
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--models-dir', type=Path, default=ROOT / '.distribution-cache/languages-integration')
parser.add_argument('--download', action='store_true')
args = parser.parse_args()
models = args.models_dir.resolve()
python = ROOT / 'bundle/runtime' / ('python/python.exe' if os.name == 'nt' else 'python/bin/python3')
environment = dict(os.environ, LLR_MODEL_ROOT=str(models), LLR_BUNDLED_RUNTIME='1', PYTHONNOUSERSITE='1')
environment.pop('PYTHONHOME', None)
environment.pop('PYTHONPATH', None)
if args.download:
    os.environ['LLR_MODEL_ROOT'] = str(models)
    spec = importlib.util.spec_from_file_location('model_manager', ROOT / 'python-worker/model_manager.py')
    manager = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(manager)
    for pair in ('en-ru', 'ru-en', 'fr-en', 'en-fr'):
        result = manager.install_models(pair)
        assert result['success'], result
samples = [('en-ru', 'Hello world'), ('fr-en', 'Bonjour le monde'), ('en-fr', 'Hello world'),
           ('ru-en', 'Это книга.'), ('fr-en', 'Merci beaucoup')]
requests = [{'command': 'translate', 'payload': {'text': text, 'sourceLanguage': pair[:2], 'targetLanguage': pair[-2:]}} for pair, text in samples]
process = subprocess.run([str(python), '-s', '-u', str(ROOT / 'python-worker/worker.py')],
                         input=''.join(json.dumps(request) + '\n' for request in requests),
                         text=True, encoding='utf-8', capture_output=True, env=environment, timeout=180)
responses = [json.loads(line) for line in process.stdout.splitlines() if line.strip()]
assert process.returncode == 0 and len(responses) == len(samples), process.stderr[-3000:]
for (pair, _), response in zip(samples, responses):
    assert response['success'], response
    assert response['result']['translator'] == 'ctranslate2:' + pair, response
    text = response['result']['translatedText']
    assert text.strip() and '\u2581' not in text, response
    print(pair, json.dumps(text, ensure_ascii=True))
assert 'world' in responses[1]['result']['translatedText'].lower(), responses[1]
assert 'thank' in responses[4]['result']['translatedText'].lower(), responses[4]
print('Verified four language pairs and repeated switching in one worker process')
