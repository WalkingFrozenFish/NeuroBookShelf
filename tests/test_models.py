import hashlib
import importlib.util
import io
import json
import os
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('model_manager', Path(__file__).resolve().parents[1] / 'python-worker/model_manager.py')
manager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(manager)

class Response(io.BytesIO):
    url = 'https://models.example.test/file'

class ModelsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.env = patch.dict(os.environ, {'LLR_MODEL_ROOT': str(self.root)})
        self.env.start()
    def tearDown(self):
        self.env.stop()
        self.tmp.cleanup()
    def entry(self, data, name='weights.bin'):
        return {'name': name, 'url': 'https://models.example.test/' + name, 'size': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
    def test_download_checks_hash_and_reuses_verified_file(self):
        data = b'model data'
        entry = self.entry(data)
        with patch.object(manager.urllib.request, 'urlopen', return_value=Response(data)) as request:
            path = manager.download(entry, self.root / '.downloads', 0, len(data))
            self.assertEqual(path.read_bytes(), data)
            manager.download(entry, self.root / '.downloads', 0, len(data))
            self.assertEqual(request.call_count, 1)
    def test_corrupt_download_does_not_install(self):
        entry = self.entry(b'correct')
        manifest = {'version': 1, 'groups': [{'id': 'test', 'target': 'ocr/det', 'files': [entry]}]}
        with patch.object(manager, 'manifest', return_value=manifest), patch.object(manager.urllib.request, 'urlopen', return_value=Response(b'corrupt')):
            self.assertFalse(manager.install_models()['success'])
        self.assertFalse((self.root / 'ocr/det/ready.json').exists())
        self.assertEqual(json.loads((self.root / 'download-progress.json').read_text())['phase'], 'error')
    def test_archive_installs_only_required_files_and_ignores_paths(self):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w') as archive:
            archive.writestr('nested/model.bin', b'weights')
            archive.writestr('../../outside.txt', b'not extracted')
        data = buffer.getvalue()
        manifest = {'version': 1, 'groups': [{'id': 'translation', 'target': 'en-ru', 'archive': self.entry(data, 'model.zip'), 'required': ['model.bin']}]}
        with patch.object(manager, 'manifest', return_value=manifest), patch.object(manager.urllib.request, 'urlopen', return_value=Response(data)) as request:
            result = manager.install_models()
            self.assertTrue(result['success'], result)
            result = manager.install_models()
            self.assertTrue(result['success'], result)
            self.assertEqual(request.call_count, 1)
        self.assertEqual((self.root / 'en-ru/model.bin').read_bytes(), b'weights')
        self.assertFalse((self.root / 'outside.txt').exists())
        self.assertTrue((self.root / 'en-ru/ready.json').exists())
    def test_duplicate_required_basename_is_rejected(self):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w') as archive:
            archive.writestr('one/model.bin', b'one')
            archive.writestr('two/model.bin', b'two')
        data = buffer.getvalue()
        manifest = {'version': 1, 'groups': [{'id': 'translation', 'target': 'en-ru', 'archive': self.entry(data, 'model.zip'), 'required': ['model.bin']}]}
        with patch.object(manager, 'manifest', return_value=manifest), patch.object(manager.urllib.request, 'urlopen', return_value=Response(data)):
            self.assertFalse(manager.install_models()['success'])
        self.assertFalse((self.root / 'en-ru/ready.json').exists())
    def test_cancel_during_download_does_not_install_and_can_retry(self):
        data = b'model data'
        entry = self.entry(data)
        manifest = {'version': 1, 'groups': [{'id': 'translation', 'target': 'en-ru', 'files': [entry]}]}
        root = self.root
        class CancellingResponse(Response):
            def read1(self, size):
                chunk = super().read(size)
                (root / 'cancel-download').write_text('cancel')
                return chunk
        with patch.object(manager, 'manifest', return_value=manifest), patch.object(manager.urllib.request, 'urlopen', return_value=CancellingResponse(data)):
            result = manager.install_models('en-ru')
        self.assertEqual(result['error']['code'], 'DOWNLOAD_CANCELLED')
        self.assertEqual(json.loads((self.root / 'download-progress.json').read_text())['phase'], 'cancelled')
        self.assertFalse((self.root / 'en-ru/ready.json').exists())
        self.assertEqual(list((self.root / '.downloads').glob('*.part')), [])
        (self.root / 'cancel-download').unlink()
        with patch.object(manager, 'manifest', return_value=manifest), patch.object(manager.urllib.request, 'urlopen', return_value=Response(data)):
            self.assertTrue(manager.install_models('en-ru')['success'])
        self.assertEqual((self.root / 'en-ru/weights.bin').read_bytes(), data)

    def test_install_selected_pair_does_not_download_other_pairs(self):
        entry = self.entry(b'french')
        other = self.entry(b'russian', 'other.bin')
        manifest = {'version': 1, 'groups': [
            {'id': 'translation', 'target': 'en-ru', 'archive': other, 'required': ['model.bin']},
            {'id': 'fr-en', 'target': 'fr-en', 'files': [entry]},
        ]}
        with patch.object(manager, 'manifest', return_value=manifest), patch.object(manager.urllib.request, 'urlopen', return_value=Response(b'french')) as request:
            self.assertTrue(manager.install_models('fr-en')['success'])
            self.assertEqual(request.call_count, 1)
        self.assertTrue((self.root / 'fr-en/ready.json').exists())
        self.assertFalse((self.root / 'en-ru').exists())

    def test_active_pair_rejects_unknown_or_malformed_selection(self):
        manifest = {'groups': [{'target': 'en-ru', 'archive': {}}, {'target': 'fr-en', 'archive': {'url': 'https://example.test'}}]}
        for value, expected in [({'pair': 'fr-en'}, 'fr-en'), ({'pair': '../outside'}, 'en-ru'), (None, 'en-ru')]:
            (self.root / 'translation-choice.json').write_text(json.dumps(value))
            with patch.object(manager, 'manifest', return_value=manifest):
                self.assertEqual(manager.active_pair(), expected)

    def test_insecure_source_rejected(self):
        entry = self.entry(b'x')
        entry['url'] = 'http://models.example.test/x'
        with self.assertRaises(ValueError): manager.download(entry, self.root / '.downloads', 0, 1)

if __name__ == '__main__': unittest.main()
