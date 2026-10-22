"""Local language detection and per-fragment routing; never downloads models."""
import re
import time
from collections import deque

from model_manager import atomic_json, installed_pairs, manifest, model_root, translation_settings

_detector = None


class RoutingError(Exception):
    def __init__(self, code, message, **details):
        super().__init__(message)
        self.code = code
        self.details = details


def language_detector():
    global _detector
    if _detector is None:
        from lingua import LanguageDetectorBuilder
        # Lazy loading keeps script-specific models out of memory until needed.
        _detector = LanguageDetectorBuilder.from_all_spoken_languages().with_minimum_relative_distance(0.1).build()
    return _detector


def language_code(language):
    return language.iso_code_639_1.name.lower() if language is not None else None


def detect_fragments(text, source="auto"):
    if source != "auto":
        return [(text, source)]
    detector = language_detector()
    result = []
    # Preserve every delimiter, including blank paragraphs and trailing spaces.
    for part in re.split(r"(\n\s*\n)", text):
        if not part or not any(c.isalpha() for c in part):
            result.append((part, None))
            continue
        sections = detector.detect_multiple_languages_of(part)
        if not sections:
            raise RoutingError("LANGUAGE_UNCERTAIN", "Не удалось определить язык. Выберите исходный язык в настройках перевода.")
        cursor = 0
        for section in sections:
            if section.start_index > cursor:
                result.append((part[cursor:section.start_index], None))
            fragment = part[section.start_index:section.end_index]
            detected = language_code(detector.detect_language_of(fragment))
            if not detected:
                raise RoutingError("LANGUAGE_UNCERTAIN", "Язык фрагмента определён неуверенно. Укажите исходный язык вручную.")
            result.append((fragment, detected))
            cursor = section.end_index
        result.append((part[cursor:], None))
    return result


def find_route(source, target, pairs):
    # The catalog uses separate regional codes for models of the same language.
    canonical = lambda code: {"pb": "pt", "zt": "zh"}.get(code, code)
    source, target = canonical(source), canonical(target)
    if source == target:
        return []
    edges = {}
    for pair in sorted(pairs):
        left, right = map(canonical, pair.split("-"))
        edges.setdefault(left, []).append((right, pair))
    pending = deque([(source, [])])
    visited = {source}
    while pending:
        language, path = pending.popleft()
        for next_language, pair in edges.get(language, []):
            route = path + [pair]
            if next_language == target:
                return route
            if next_language not in visited and len(route) < 2:
                visited.add(next_language)
                pending.append((next_language, route))
    return None


def translate_routed(text, translate_pair, source=None, target=None):
    settings = translation_settings()
    source = source or settings["sourceLanguage"]
    target = target or settings["targetLanguage"]
    if (source != "auto" and not re.fullmatch(r"[a-z]{2,3}", source)) or not re.fullmatch(r"[a-z]{2,3}", target):
        raise RoutingError("UNSUPPORTED_LANGUAGE", "Некорректное направление перевода")
    fragments = detect_fragments(text, source)
    pairs = installed_pairs()
    available = [g["target"] for g in manifest()["groups"] if g.get("archive")]
    routes = {}
    missing = []
    for _, language in fragments:
        if not language or language in routes:
            continue
        route = find_route(language, target, pairs)
        if route is None:
            offered = find_route(language, target, available)
            needed = [pair for pair in (offered or []) if pair not in pairs]
            missing.append({"source": language, "target": target, "pairs": needed})
        else:
            routes[language] = route
    if missing:
        summary = "; ".join(f"{item['source']} → {item['target']}: " + (", ".join(item["pairs"]) or "—") for item in missing)
        raise RoutingError("MODEL_MISSING", "Нужны модели: " + summary + ". Откройте Настройки → Модели.", missingModels=missing)
    usage = {"sourceLanguages": list(routes), "targetLanguage": target,
             "pairs": list(dict.fromkeys(pair for route in routes.values() for pair in route)),
             "phase": "translating", "updatedAt": time.time()}
    atomic_json(model_root() / "last-translation.json", usage)
    output = []
    try:
        for fragment, language in fragments:
            if not language or not routes[language]:
                output.append(fragment)
                continue
            prefix = fragment[:len(fragment) - len(fragment.lstrip())]
            suffix = fragment[len(fragment.rstrip()):]
            translated = fragment.strip()
            for pair in routes[language]:
                translated = translate_pair(pair, translated)
            output.append(prefix + translated + suffix)
        usage["phase"] = "ready"
    except Exception:
        usage["phase"] = "error"
        raise
    finally:
        usage["updatedAt"] = time.time()
        atomic_json(model_root() / "last-translation.json", usage)
    languages = list(routes)
    label = languages[0] if len(languages) == 1 else "auto"
    return {"translatedText": "".join(output), "translator": f"ctranslate2:{label}-{target}",
            "sourceLanguages": languages, "targetLanguage": target, "routes": routes,
            "alreadyTarget": not usage["pairs"], "usedModels": usage["pairs"]}
