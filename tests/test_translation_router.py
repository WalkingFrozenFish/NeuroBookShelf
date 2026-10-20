import importlib.util
import io
import json
import os
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python-worker"))
import translation_router as router
import model_manager as manager


class RoutingTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.env = patch.dict(os.environ, {"LLR_MODEL_ROOT": str(self.root)})
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self.tmp.cleanup()

    def test_direct_model_wins_over_pivot(self):
        self.assertEqual(router.find_route("fr", "ru", ["fr-en", "en-ru", "fr-ru"]), ["fr-ru"])
        self.assertEqual(router.find_route("fr", "ru", ["fr-en", "en-ru"]), ["fr-en", "en-ru"])
        self.assertEqual(router.find_route("pt", "ru", ["pb-en", "en-ru"]), ["pb-en", "en-ru"])

    def test_cycles_and_missing_routes_terminate(self):
        self.assertIsNone(router.find_route("fr", "de", ["fr-en", "en-fr", "en-ru"]))
        self.assertIsNone(router.find_route("fr", "de", ["fr-en", "en-ru", "ru-de"]))

    def test_mixed_languages_keep_target_fragments_and_delimiters(self):
        fragments = [("  English text. ", "en"), ("\n\n", None), ("Français. ", "fr"), ("Русский.", "ru")]
        calls = []
        def translate(pair, text):
            calls.append((pair, text))
            return f"[{pair}:{text}]"
        with patch.object(router, "detect_fragments", return_value=fragments), patch.object(router, "installed_pairs", return_value=["en-ru", "fr-en"]):
            result = router.translate_routed("fixture", translate, "auto", "ru")
        self.assertEqual([pair for pair, _ in calls], ["en-ru", "fr-en", "en-ru"])
        self.assertEqual(result["translatedText"], "  [en-ru:English text.] \n\n[en-ru:[fr-en:Français.]] Русский.")
        self.assertEqual(result["sourceLanguages"], ["en", "fr", "ru"])
        self.assertEqual(result["translator"], "ctranslate2:auto-ru")
        self.assertFalse(result["alreadyTarget"])
        usage = json.loads((self.root / "last-translation.json").read_text())
        self.assertEqual(usage["phase"], "ready")

    def test_missing_model_reports_installable_route_without_partial_translation(self):
        groups = [{"target": pair, "archive": {"url": "https://argos-net.com/model.argosmodel"}} for pair in ["fr-en", "en-ru"]]
        with patch.object(router, "detect_fragments", return_value=[("French text", "fr")]), patch.object(router, "installed_pairs", return_value=["en-ru"]), patch.object(router, "manifest", return_value={"groups": groups}):
            with self.assertRaises(router.RoutingError) as raised:
                router.translate_routed("fixture", lambda *_: self.fail("No partial inference"), "auto", "ru")
        self.assertEqual(raised.exception.code, "MODEL_MISSING")
        self.assertEqual(raised.exception.details["missingModels"][0]["pairs"], ["fr-en"])

    def test_target_language_needs_no_model(self):
        result = router.translate_routed("Русский текст", lambda *_: self.fail("No inference needed"), "ru", "ru")
        self.assertEqual(result["translatedText"], "Русский текст")
        self.assertTrue(result["alreadyTarget"])

    def test_manual_source_does_not_load_language_detector(self):
        with patch.object(router, "language_detector", side_effect=AssertionError("Do not detect")):
            self.assertEqual(router.detect_fragments("Bonjour", "fr"), [("Bonjour", "fr")])

    def test_failed_inference_marks_usage_as_error(self):
        with patch.object(router, "installed_pairs", return_value=["en-ru"]):
            with self.assertRaises(ValueError):
                router.translate_routed("Hello", lambda *_: (_ for _ in ()).throw(ValueError("bad model")), "en", "ru")
        self.assertEqual(json.loads((self.root / "last-translation.json").read_text())["phase"], "error")

    def test_malformed_language_and_legacy_settings(self):
        with self.assertRaises(router.RoutingError):
            router.translate_routed("Hello", lambda *_: "", "../en", "ru")
        (self.root / "translation-choice.json").write_text('{"pair":"fr-en"}')
        self.assertEqual(manager.translation_settings(), {"sourceLanguage": "auto", "targetLanguage": "en"})
        (self.root / "translation-choice.json").write_text('null')
        self.assertEqual(manager.translation_settings()["targetLanguage"], "ru")


class CatalogTests(unittest.TestCase):
    def package(self, source="fr", target="en", version="1.9", url=None):
        return {"from_code": source, "to_code": target, "package_version": version,
                "from_name": "French", "to_name": "English",
                "links": [url or f"https://argos-net.com/v1/translate-{source}_{target}-1_9.argosmodel"]}

    def test_remote_catalog_adds_languages_not_in_bundle(self):
        groups = manager.normalize_catalog([self.package("de", "en")])
        self.assertEqual(groups[0]["target"], "de-en")
        self.assertEqual(groups[0]["packageVersion"], "1.9")

    def test_catalog_rejects_untrusted_urls_and_paths(self):
        for url in ["http://argos-net.com/m.argosmodel", "https://evil.test/m.argosmodel", "https://argos-net.com:bad/m.argosmodel", "https://evil@argos-net.com/m.argosmodel"]:
            self.assertEqual(manager.normalize_catalog([self.package(url=url)]), [])
        self.assertEqual(manager.normalize_catalog([self.package("../fr", "en")]), [])

    def test_latest_version_per_pair_and_pinned_integrity(self):
        groups = manager.normalize_catalog([self.package(version="1.8"), self.package(version="1.9"), self.package(version="1.7")])
        self.assertEqual(len(groups), 1)
        self.assertEqual(groups[0]["packageVersion"], "1.9")
        en_ru = manager.normalize_catalog([self.package("en", "ru")])[0]
        self.assertIn("sha256", en_ru["archive"])

    def test_offline_manifest_retains_cached_remote_catalog(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"LLR_MODEL_ROOT": directory}):
            root = Path(directory)
            (root / "catalog.json").write_text(json.dumps({"packages": [self.package("de", "en")]}))
            self.assertIn("de-en", [g["target"] for g in manager.manifest()["groups"]])
            with patch.object(manager.urllib.request, "urlopen", side_effect=OSError("offline")):
                self.assertFalse(manager.refresh_catalog()["success"])
            self.assertIn("de-en", [g["target"] for g in manager.manifest()["groups"]])

    def test_install_remote_package_without_size_or_published_hash(self):
        class Response(io.BytesIO):
            url = "https://argos-net.com/v1/model.argosmodel"
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            for name, data in {
                "model.bin": b"weights", "config.json": b"{}", "sentencepiece.model": b"tokenizer",
                "shared_vocabulary.json": b"[]", "README.md": b"model attribution",
                "metadata.json": json.dumps({"from_code": "de", "to_code": "en", "package_version": "1.9"}).encode(),
            }.items():
                archive.writestr("nested/" + name, data)
            archive.writestr("../../outside.txt", b"ignored")
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"LLR_MODEL_ROOT": directory}):
            root = Path(directory)
            (root / "catalog.json").write_text(json.dumps({"packages": [self.package("de", "en")]}))
            with patch.object(manager.urllib.request, "urlopen", return_value=Response(buffer.getvalue())):
                result = manager.install_models("de-en")
            self.assertTrue(result["success"], result)
            self.assertTrue((root / "de-en/ready.json").is_file())
            self.assertEqual((root / "de-en/shared_vocabulary.json").read_bytes(), b"[]")
            self.assertEqual((root / "de-en/README.md").read_bytes(), b"model attribution")
            self.assertFalse((root / "outside.txt").exists())
            self.assertFalse((root / "ocr").exists())
            self.assertIn("de-en", manager.installed_pairs())

    def test_downloaded_package_with_different_languages_is_rejected(self):
        class Response(io.BytesIO):
            url = "https://argos-net.com/v1/model.argosmodel"
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr("metadata.json", json.dumps({"from_code": "fr", "to_code": "en", "package_version": "1.9"}))
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"LLR_MODEL_ROOT": directory}):
            root = Path(directory)
            (root / "catalog.json").write_text(json.dumps({"packages": [self.package("de", "en")]}))
            with patch.object(manager.urllib.request, "urlopen", return_value=Response(buffer.getvalue())):
                result = manager.install_models("de-en")
            self.assertFalse(result["success"], result)
            self.assertFalse((root / "de-en/ready.json").exists())


if __name__ == "__main__":
    unittest.main()
