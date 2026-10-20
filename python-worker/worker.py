"""Local JSON worker. Protocol replies use the original stdout; library logs go to stderr."""

import json
import os
import re
import sys
from pathlib import Path

os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
os.environ.setdefault("GLOG_minloglevel", "2")
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")

_protocol_fd = os.dup(sys.stdout.fileno())
os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
protocol_out = os.fdopen(_protocol_fd, "w", encoding="utf-8", buffering=1)

TARGET_DPI = 300
MAX_SIDE = 1600
PARAGRAPH_GAP_RATIO = 1.2
PARAGRAPH_INDENT = 0.016
SAME_LINE_OVERLAP = 0.5
SAME_LINE_GAP = 0.025
BASELINE_CENTER = 0.55
COLUMN_OVERLAP = 0.4
BANNER_WIDTH_RATIO = 1.45
BANNER_MIN_WIDTH = 0.5
FONT_SIZE_RATIO = 1.5
OCR_HEIGHT_RATIO = 2.5
MAX_TRANSLATION_TOKENS = 160
_engine = None
_translator = None
_SENTENCE_BREAK = re.compile(r"(?<=[.!?])\s+(?=[\"“'(\[]?[A-Z])")


def error(code, message):
    return {"success": False, "error": {"code": code, "message": message}}


def short_error(exc):
    text = " ".join(str(exc).split())
    return text[:300] if len(text) > 300 else text


def handle(message):
    if not isinstance(message, dict):
        return error("INVALID_REQUEST", "Request must be a JSON object")
    command = message.get("command")
    if not isinstance(command, str) or command == "":
        return error("INVALID_REQUEST", "Command is required")
    if command == "ping":
        return {"success": True, "result": "pong"}
    if command == "echo":
        payload = message.get("payload")
        if not isinstance(payload, str):
            return error("INVALID_PAYLOAD", "Echo payload must be a string")
        return {"success": True, "result": payload}
    if command == "analyze_page":
        return analyze_page(message.get("payload"))
    if command == "ocr_region":
        return ocr_region(message.get("payload"))
    if command == "ocr_page":
        return ocr_page(message.get("payload"))
    if command == "translate":
        return translate_text(message.get("payload"))
    if command == "warm_translator":
        return warm_translator()
    if command == "install_models":
        from model_manager import install_models
        return install_models()
    return error("UNKNOWN_COMMAND", "Unknown command")


def analyze_page(payload):
    if not isinstance(payload, dict):
        return error("INVALID_PAYLOAD", "Analyze payload must be an object")
    path_value = payload.get("path")
    page_number = payload.get("pageNumber")
    if not isinstance(path_value, str) or path_value.strip() == "":
        return error("INVALID_PATH", "PDF path is required")
    if isinstance(page_number, bool) or not isinstance(page_number, int) or page_number < 1:
        return error("INVALID_PAGE", "Page number must be an integer starting at 1")
    path = Path(path_value)
    if not path.exists():
        return error("FILE_NOT_FOUND", "PDF file does not exist")
    if not path.is_file():
        return error("INVALID_PATH", "PDF path is not a file")
    try:
        import pymupdf
    except ImportError:
        return error("PYMUPDF_MISSING", "PyMuPDF is not installed")
    try:
        data = path.read_bytes()
        document = pymupdf.open(stream=data, filetype="pdf")
    except Exception:
        return error("INVALID_PDF", "PDF file is invalid or damaged")
    try:
        if document.needs_pass:
            return error("PDF_ERROR", "PDF is password protected")
        if page_number > document.page_count:
            return error("PAGE_OUT_OF_RANGE", "Page number is out of range")
        page = document[page_number - 1]
        return page_text(page, page_number)
    except Exception:
        return error("PDF_ERROR", "PyMuPDF failed to read the page")
    finally:
        document.close()


def page_text(page, page_number):
    width = float(page.rect.width)
    height = float(page.rect.height)
    blocks = paragraphs_from_lines(page_lines(page, width, height))
    result = {
        "pageNumber": page_number,
        "pageWidth": round(width, 3),
        "pageHeight": round(height, 3),
        "hasTextLayer": bool(blocks),
        "blocks": blocks,
    }
    return {"success": True, "result": result}


def page_lines(page, width, height):
    lines = []
    if width <= 0 or height <= 0:
        return lines
    for block in page.get_text("dict").get("blocks", []):
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            spans = line.get("spans") or []
            text = " ".join("".join(str(span.get("text", "")) for span in spans).split())
            if text == "" or not any(char.isalnum() for char in text):
                continue
            bbox = line.get("bbox")
            if not bbox or len(bbox) < 4:
                continue
            box = relative_box(bbox[0], bbox[1], bbox[2], bbox[3], width, height)
            if box is None:
                continue
            box["text"] = text
            size = dominant_size((span.get("size"), span.get("text", "")) for span in spans)
            if size is not None:
                box["size"] = size
            lines.append(box)
    return lines


def relative_box(x0, y0, x1, y1, width, height):
    left = min(max(float(x0), 0.0), width)
    right = min(max(float(x1), 0.0), width)
    top = min(max(float(y0), 0.0), height)
    bottom = min(max(float(y1), 0.0), height)
    if right < left:
        left, right = right, left
    if bottom < top:
        top, bottom = bottom, top
    box_width = right - left
    box_height = bottom - top
    if box_width <= 0 or box_height <= 0:
        return None
    return {
        "x": round(left / width, 4),
        "y": round(top / height, 4),
        "width": round(box_width / width, 4),
        "height": round(box_height / height, 4),
    }


def paragraphs_from_lines(lines):
    if not lines:
        return []
    lines = merge_same_lines(lines)
    widths = sorted(line["width"] for line in lines)
    median_width = widths[len(widths) // 2]
    banners = []
    body = []
    for line in lines:
        wide = line["width"] > median_width * BANNER_WIDTH_RATIO and line["width"] >= BANNER_MIN_WIDTH
        if wide:
            banners.append(line)
        else:
            body.append(line)
    blocks = []
    blocks.extend(group_column(banners))
    for column in cluster_columns(body):
        blocks.extend(group_column(column))
    blocks.sort(key=lambda block: (block["y"], block["x"]))
    for block in blocks:
        block.pop("size", None)
    return blocks


def merge_same_lines(lines):
    groups = []
    for line in sorted(lines, key=lambda item: (item["y"], item["x"])):
        best = None
        best_distance = None
        for index, group in enumerate(groups):
            distance = same_line_distance(group, line)
            if distance is None:
                continue
            if best_distance is None or distance < best_distance:
                best = index
                best_distance = distance
        if best is None:
            groups.append([line])
        else:
            groups[best].append(line)
    return [merge_paragraph(group) for group in groups]


def same_line_distance(group, line):
    best = None
    for item in group:
        box = line_box(item)
        if not same_baseline(box, line, item["height"]):
            continue
        distance = horizontal_distance(box, line)
        if distance is None:
            continue
        if best is None or distance < best:
            best = distance
    return best


def same_baseline(box, line, ref_height):
    line_h = max(line["height"], 1e-6)
    ref = max(ref_height, 1e-6)
    center_line = line["y"] + line["height"] / 2
    center_box = (box["top"] + box["bottom"]) / 2
    if abs(center_line - center_box) <= BASELINE_CENTER * max(line_h, ref):
        return True
    overlap_y = min(box["bottom"], line["y"] + line["height"]) - max(box["top"], line["y"])
    return overlap_y / min(line_h, ref) >= SAME_LINE_OVERLAP


def horizontal_distance(box, line):
    overlap_x = min(box["right"], line["x"] + line["width"]) - max(box["left"], line["x"])
    if overlap_x > 0:
        return 0.0
    if line["x"] >= box["left"]:
        gap_x = line["x"] - box["right"]
    else:
        gap_x = box["left"] - (line["x"] + line["width"])
    if gap_x <= SAME_LINE_GAP:
        return gap_x
    return None


def line_box(line):
    return {
        "left": line["x"],
        "top": line["y"],
        "right": line["x"] + line["width"],
        "bottom": line["y"] + line["height"],
    }


def cluster_columns(lines):
    columns = []
    ordered = sorted(lines, key=lambda item: (-item["width"], item["x"], item["y"]))
    for line in ordered:
        best = None
        best_overlap = 0.0
        for index, column in enumerate(columns):
            overlap = horizontal_overlap(union_box(column), line)
            if overlap > best_overlap:
                best_overlap = overlap
                best = index
        if best is not None and best_overlap >= COLUMN_OVERLAP:
            columns[best].append(line)
        else:
            columns.append([line])
    columns.sort(key=lambda column: min(item["x"] for item in column))
    return columns


def group_column(lines):
    groups = []
    for line in sorted(lines, key=lambda item: (item["y"], item["x"])):
        best = None
        best_gap = None
        for index, group in enumerate(groups):
            gap = continuation_gap(group, line)
            if gap is None:
                continue
            if best_gap is None or gap < best_gap:
                best = index
                best_gap = gap
        if best is None:
            groups.append([line])
        else:
            groups[best].append(line)
    return [merge_paragraph(group) for group in groups]


def continuation_gap(group, line):
    for item in group:
        if same_baseline(line_box(item), line, item["height"]) and horizontal_distance(line_box(item), line) is not None:
            return 0.0
    previous = max(group, key=lambda item: (item["y"] + item["height"] / 2, item["x"]))
    heights = sorted(item["height"] for item in group)
    para_h = max(heights[len(heights) // 2], 1e-6)
    prev_center = previous["y"] + previous["height"] / 2
    line_center = line["y"] + line["height"] / 2
    if line_center <= prev_center:
        return None
    gap = line["y"] - (prev_center + para_h / 2)
    if gap > para_h * PARAGRAPH_GAP_RATIO:
        return None
    if horizontal_overlap(union_box(group), line) < 0.35:
        return None
    if different_style_size(group, line):
        return None
    widths = sorted(item["width"] for item in group)
    median_width = widths[len(widths) // 2]
    body_left = min(item["x"] for item in group)
    if line["x"] - body_left > PARAGRAPH_INDENT and previous["width"] < median_width * 0.8:
        return None
    return max(line_center - prev_center, 0.0)


def different_style_size(group, line):
    group_size = dominant_size((item.get("size"), item.get("text", "")) for item in group)
    line_size = line.get("size")
    if group_size is not None and isinstance(line_size, (int, float)) and not isinstance(line_size, bool) and line_size > 0:
        return line_size > group_size * FONT_SIZE_RATIO or group_size > line_size * FONT_SIZE_RATIO
    line_h = max(line["height"], 1e-6)
    heights = sorted(item["height"] for item in group)
    para_h = max(heights[len(heights) // 2], 1e-6)
    return line_h > para_h * OCR_HEIGHT_RATIO or para_h > line_h * OCR_HEIGHT_RATIO


def dominant_size(items):
    weighted = []
    for size, text in items:
        if isinstance(size, bool) or not isinstance(size, (int, float)) or size <= 0:
            continue
        weight = max(len(str(text).strip()), 1)
        weighted.append((float(size), weight))
    if not weighted:
        return None
    weighted.sort()
    total = sum(weight for _size, weight in weighted)
    acc = 0.0
    for size, weight in weighted:
        acc += weight
        if acc >= total / 2:
            return round(size, 2)
    return round(weighted[-1][0], 2)


def horizontal_overlap(box, line):
    overlap = min(box["right"], line["x"] + line["width"]) - max(box["left"], line["x"])
    narrower = min(line["width"], box["right"] - box["left"])
    if narrower <= 0:
        return 0.0
    return overlap / narrower


def union_box(lines):
    return {
        "left": min(item["x"] for item in lines),
        "top": min(item["y"] for item in lines),
        "right": max(item["x"] + item["width"] for item in lines),
        "bottom": max(item["y"] + item["height"] for item in lines),
    }


def merge_paragraph(lines):
    ordered = sorted(lines, key=lambda item: (item["y"] + item["height"] * 0.5, item["x"]))
    box = union_box(ordered)
    block = {
        "text": join_line_texts(ordered),
        "x": round(box["left"], 4),
        "y": round(box["top"], 4),
        "width": round(box["right"] - box["left"], 4),
        "height": round(box["bottom"] - box["top"], 4),
    }
    scores = [
        item["confidence"]
        for item in ordered
        if isinstance(item.get("confidence"), (int, float)) and not isinstance(item.get("confidence"), bool)
    ]
    if scores:
        block["confidence"] = round(sum(scores) / len(scores), 4)
    size = dominant_size((item.get("size"), item.get("text", "")) for item in ordered)
    if size is not None:
        block["size"] = size
    return block


def reading_order(lines):
    rows = []
    for line in sorted(lines, key=lambda item: (item["y"] + item["height"] / 2, item["x"])):
        row_index = None
        for index, row in enumerate(rows):
            if any(same_baseline(line_box(item), line, item["height"]) for item in row):
                row_index = index
                break
        if row_index is None:
            rows.append([line])
        else:
            rows[row_index].append(line)
    ordered = []
    for row in rows:
        ordered.extend(sorted(row, key=lambda item: item["x"]))
    return ordered


def join_line_texts(lines):
    result = ""
    previous = None
    for line in reading_order(lines):
        text = " ".join(str(line["text"]).split())
        if text == "":
            continue
        if result == "":
            result = text
            previous = line
            continue
        if previous is not None and not same_visual_line(previous, line) and dehyphenate(result, text):
            result = strip_hyphen(result) + text
        else:
            result = f"{result} {text}"
        previous = line
    return result


def same_visual_line(left, right):
    return same_baseline(line_box(left), right, left["height"])


def dehyphenate(previous, text):
    if previous.endswith("\u00ad"):
        return True
    return text[:1].islower() and previous.endswith("-") and not previous.endswith("--")


def strip_hyphen(text):
    if text.endswith("-") or text.endswith("\u00ad"):
        return text[:-1]
    return text


def join_wrapped_text(text):
    cleaned = text.replace("\r\n", "\n").replace("\r", "\n")
    paragraphs = []
    for part in re.split(r"\n\s*\n", cleaned):
        result = ""
        for line in part.split("\n"):
            line = " ".join(line.split())
            if line == "":
                continue
            if result == "":
                result = line
                continue
            if dehyphenate(result, line):
                result = strip_hyphen(result) + line
            else:
                result = f"{result} {line}"
        if result:
            paragraphs.append(result)
    return paragraphs


def token_chunks(tokens, limit):
    chunks = []
    current = []
    for token in tokens:
        if current and len(current) >= limit and token.startswith("\u2581"):
            chunks.append(current)
            current = [token]
            continue
        current.append(token)
        if len(current) >= limit * 2:
            chunks.append(current)
            current = []
    if current:
        chunks.append(current)
    return chunks


def ocr_region(payload):
    if not isinstance(payload, dict):
        return error("INVALID_PAYLOAD", "OCR payload must be an object")
    path_value = payload.get("pdfPath")
    page_number = payload.get("pageNumber")
    rect = parse_rect(payload.get("rect"))
    if not isinstance(path_value, str) or path_value.strip() == "":
        return error("INVALID_PATH", "PDF path is required")
    if isinstance(page_number, bool) or not isinstance(page_number, int) or page_number < 1:
        return error("INVALID_PAGE", "Page number must be an integer starting at 1")
    if rect is None:
        return error("INVALID_REGION", "Region must lie inside the page and have a positive size")
    path = Path(path_value)
    if not path.exists():
        return error("FILE_NOT_FOUND", "PDF file does not exist")
    if not path.is_file():
        return error("INVALID_PATH", "PDF path is not a file")
    try:
        import pymupdf
    except ImportError:
        return error("PYMUPDF_MISSING", "PyMuPDF is not installed")
    try:
        document = pymupdf.open(stream=path.read_bytes(), filetype="pdf")
    except Exception:
        return error("INVALID_PDF", "PDF file is invalid or damaged")
    try:
        if document.needs_pass:
            return error("PDF_ERROR", "PDF is password protected")
        if page_number > document.page_count:
            return error("PAGE_OUT_OF_RANGE", "Page number is out of range")
        page = document[page_number - 1]
        image = render_region(page, rect)
    except Exception:
        return error("RENDER_ERROR", "PyMuPDF failed to render the region")
    finally:
        document.close()
    if image is None:
        return error("INVALID_REGION", "Region does not cover the page")
    try:
        engine = ocr_engine()
    except ImportError:
        return error("PADDLEOCR_MISSING", "PaddleOCR is not installed")
    except Exception as exc:
        return error("OCR_ERROR", f"PaddleOCR failed to start: {short_error(exc)}")
    try:
        predictions = list(engine.predict(image))
    except Exception as exc:
        return error("OCR_ERROR", f"PaddleOCR failed to read the region: {short_error(exc)}")
    return {
        "success": True,
        "result": ocr_result(predictions, int(image.shape[1]), int(image.shape[0])),
    }


def ocr_page(payload):
    if not isinstance(payload, dict):
        return error("INVALID_PAYLOAD", "OCR payload must be an object")
    path_value = payload.get("pdfPath")
    page_number = payload.get("pageNumber")
    if not isinstance(path_value, str) or path_value.strip() == "":
        return error("INVALID_PATH", "PDF path is required")
    if isinstance(page_number, bool) or not isinstance(page_number, int) or page_number < 1:
        return error("INVALID_PAGE", "Page number must be an integer starting at 1")
    path = Path(path_value)
    if not path.exists():
        return error("FILE_NOT_FOUND", "PDF file does not exist")
    if not path.is_file():
        return error("INVALID_PATH", "PDF path is not a file")
    try:
        import pymupdf
    except ImportError:
        return error("PYMUPDF_MISSING", "PyMuPDF is not installed")
    try:
        document = pymupdf.open(stream=path.read_bytes(), filetype="pdf")
    except Exception:
        return error("INVALID_PDF", "PDF file is invalid or damaged")
    try:
        if document.needs_pass:
            return error("PDF_ERROR", "PDF is password protected")
        if page_number > document.page_count:
            return error("PAGE_OUT_OF_RANGE", "Page number is out of range")
        page = document[page_number - 1]
        image = render_region(page, {"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0})
    except Exception:
        return error("RENDER_ERROR", "PyMuPDF failed to render the page")
    finally:
        document.close()
    if image is None:
        return error("RENDER_ERROR", "PyMuPDF failed to render the page")
    try:
        engine = ocr_engine()
    except ImportError:
        return error("PADDLEOCR_MISSING", "PaddleOCR is not installed")
    except Exception as exc:
        return error("OCR_ERROR", f"PaddleOCR failed to start: {short_error(exc)}")
    try:
        predictions = list(engine.predict(image))
    except Exception as exc:
        return error("OCR_ERROR", f"PaddleOCR failed to read the page: {short_error(exc)}")
    return {
        "success": True,
        "result": {
            "blocks": ocr_page_blocks(predictions, int(image.shape[1]), int(image.shape[0])),
        },
    }


def ocr_page_blocks(predictions, image_width, image_height):
    lines, _loose = prediction_lines(predictions, image_width, image_height, True, True)
    return paragraphs_from_lines(lines)


def poly_box(polys, index, image_width, image_height):
    if index >= len(polys) or image_width <= 0 or image_height <= 0:
        return None
    try:
        points = list(polys[index])
        xs = [float(point[0]) for point in points]
        ys = [float(point[1]) for point in points]
    except Exception:
        return None
    if not xs or not ys:
        return None
    return relative_box(min(xs), min(ys), max(xs), max(ys), image_width, image_height)


def parse_rect(value):
    if not isinstance(value, dict):
        return None
    numbers = []
    for key in ("x", "y", "width", "height"):
        number = value.get(key)
        if isinstance(number, bool) or not isinstance(number, (int, float)):
            return None
        numbers.append(float(number))
    x, y, width, height = numbers
    if width <= 0 or height <= 0 or x < 0 or y < 0 or x > 1 or y > 1:
        return None
    if x + width > 1.001 or y + height > 1.001:
        return None
    return {
        "x": x,
        "y": y,
        "width": min(width, 1 - x),
        "height": min(height, 1 - y),
    }


def render_region(page, rect):
    import numpy as np

    bounds = page.rect
    clip = pymupdf_rect(bounds, rect)
    if clip is None:
        return None
    scale = TARGET_DPI / 72
    longest = max(clip.width, clip.height) * scale
    if longest > MAX_SIDE:
        scale *= MAX_SIDE / longest
    import pymupdf

    pixmap = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), clip=clip, alpha=False)
    if pixmap.width < 2 or pixmap.height < 2 or pixmap.n < 3:
        return None
    image = np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(pixmap.height, pixmap.width, pixmap.n)
    image = np.ascontiguousarray(image[:, :, :3][:, :, ::-1])
    return image


def pymupdf_rect(bounds, rect):
    import pymupdf

    clip = pymupdf.Rect(
        rect["x"] * bounds.width,
        rect["y"] * bounds.height,
        (rect["x"] + rect["width"]) * bounds.width,
        (rect["y"] + rect["height"]) * bounds.height,
    ) & bounds
    if clip.is_empty or clip.width < 1 or clip.height < 1:
        return None
    return clip


def ocr_engine():
    global _engine
    if _engine is not None:
        return _engine
    from paddleocr import PaddleOCR

    options = {}
    configured_root = os.environ.get("LLR_MODEL_ROOT", "").strip()
    if configured_root:
        root = Path(configured_root) / "ocr"
        if not all((root / part / "inference.pdiparams").is_file() for part in ("det", "rec")):
            raise FileNotFoundError("Модели OCR не установлены. Откройте «Модели» в приложении.")
        options = {
            "text_detection_model_name": "PP-OCRv5_mobile_det",
            "text_detection_model_dir": str(root / "det"),
            "text_recognition_model_name": "en_PP-OCRv5_mobile_rec",
            "text_recognition_model_dir": str(root / "rec"),
            "device": "cpu",
        }

    try:
        _engine = PaddleOCR(
            lang="en",
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
            **options,
        )
    except TypeError:
        if options:
            raise
        _engine = PaddleOCR(lang="en")
    try:
        sys.stderr.write("ocr-engine-ready\n")
        sys.stderr.flush()
    except OSError:
        pass
    return _engine


def prediction_lines(predictions, image_width, image_height, require_alnum, drop_tiny):
    lines = []
    loose = []
    for prediction in predictions:
        data = prediction.json if hasattr(prediction, "json") else prediction
        if isinstance(data, dict) and isinstance(data.get("res"), dict):
            data = data["res"]
        if not isinstance(data, dict):
            continue
        texts = data.get("rec_texts") or []
        scores = data.get("rec_scores") or []
        polys = data.get("rec_polys") or data.get("dt_polys") or []
        for index, raw_text in enumerate(texts):
            text = " ".join(str(raw_text).split())
            if text == "":
                continue
            if require_alnum and not any(char.isalnum() for char in text):
                continue
            score = scores[index] if index < len(scores) else None
            box = poly_box(polys, index, image_width, image_height)
            if box is None or (drop_tiny and (box["width"] < 0.004 or box["height"] < 0.004)):
                loose.append((index, text, score))
                continue
            line = {
                "text": text,
                "x": box["x"],
                "y": box["y"],
                "width": box["width"],
                "height": box["height"],
            }
            if isinstance(score, (int, float)) and not isinstance(score, bool):
                line["confidence"] = round(float(score), 4)
            lines.append(line)
    return lines, loose


def ocr_result(predictions, image_width, image_height):
    lines, loose = prediction_lines(predictions, image_width, image_height, False, False)
    paragraphs = paragraphs_from_lines(lines)
    for _index, text, score in loose:
        block = {"text": text, "x": 0.0, "y": 1.0, "width": 1.0, "height": 0.01}
        if isinstance(score, (int, float)) and not isinstance(score, bool):
            block["confidence"] = round(float(score), 4)
        paragraphs.append(block)
    blocks = []
    for paragraph in paragraphs:
        block = {"text": paragraph["text"]}
        if "confidence" in paragraph:
            block["confidence"] = paragraph["confidence"]
        blocks.append(block)
    return {"text": "\n\n".join(block["text"] for block in blocks), "blocks": blocks}


class Translator:
    def translate(self, text):
        raise NotImplementedError


class LocalTranslator(Translator):
    def __init__(self):
        self._engine = None
        self._tokenizer = None

    def translate(self, text):
        self._ensure()
        paragraphs = []
        for paragraph in join_wrapped_text(text):
            translated = self._translate_paragraph(paragraph)
            if translated:
                paragraphs.append(translated)
        return "\n\n".join(paragraphs)

    def _translate_paragraph(self, text):
        tokens = self._tokenizer.encode(text, out_type=str)
        if not tokens:
            return ""
        if len(tokens) <= MAX_TRANSLATION_TOKENS:
            return self._decode(tokens)
        sentences = [part.strip() for part in _SENTENCE_BREAK.split(text) if part.strip()]
        if len(sentences) <= 1:
            return " ".join(self._decode(chunk) for chunk in token_chunks(tokens, MAX_TRANSLATION_TOKENS))
        return " ".join(part for part in (self._translate_paragraph(sentence) for sentence in sentences) if part)

    def _decode(self, tokens):
        if not tokens:
            return ""
        hypothesis = self._engine.translate_batch([tokens])[0].hypotheses[0]
        return self._tokenizer.decode(hypothesis).strip()

    def _ensure(self):
        if self._engine is not None:
            return
        directory = translation_model_dir()
        model = directory / "model.bin"
        tokenizer = directory / "sentencepiece.model"
        if not model.is_file() or not tokenizer.is_file():
            raise FileNotFoundError(str(directory))
        import ctranslate2
        import sentencepiece

        self._tokenizer = sentencepiece.SentencePieceProcessor(model_file=str(tokenizer))
        self._engine = ctranslate2.Translator(str(directory), device="cpu")
        try:
            sys.stderr.write("translator-ready\n")
            sys.stderr.flush()
        except OSError:
            pass


def translation_model_dir():
    override = os.environ.get("LLR_TRANSLATION_MODEL", "").strip()
    if override:
        return Path(override)
    model_root = os.environ.get("LLR_MODEL_ROOT", "").strip()
    if model_root:
        directory = Path(model_root) / "en-ru"
        if (directory / "model.bin").is_file() or os.environ.get("LLR_BUNDLED_RUNTIME"):
            return directory
    return Path(__file__).resolve().parent / "models" / "en-ru"


def translator():
    global _translator
    if _translator is None:
        _translator = LocalTranslator()
    return _translator


def warm_translator():
    try:
        translator().translate("Hello.")
    except ImportError:
        return error("MODEL_UNAVAILABLE", "Translation engine is not installed")
    except FileNotFoundError:
        return error("MODEL_MISSING", "Translation model files are not installed")
    except Exception as exc:
        return error("TRANSLATION_ERROR", f"Translation failed: {short_error(exc)}")
    return {"success": True, "result": "ready"}


def translate_text(payload):
    if not isinstance(payload, dict):
        return error("INVALID_PAYLOAD", "Translate payload must be an object")
    text = payload.get("text")
    source = payload.get("sourceLanguage")
    target = payload.get("targetLanguage")
    if not isinstance(text, str) or not isinstance(source, str) or not isinstance(target, str):
        return error("INVALID_PAYLOAD", "Translate payload requires text and language codes")
    if text.strip() == "":
        return error("EMPTY_TEXT", "Text is empty")
    if source.strip().lower() != "en" or target.strip().lower() != "ru":
        return error("UNSUPPORTED_LANGUAGE", "Only English to Russian is available")
    try:
        translated = translator().translate(text)
    except ImportError:
        return error("MODEL_UNAVAILABLE", "Translation engine is not installed")
    except FileNotFoundError:
        return error("MODEL_MISSING", "Translation model files are not installed")
    except Exception as exc:
        return error("TRANSLATION_ERROR", f"Translation failed: {short_error(exc)}")
    return {
        "success": True,
        "result": {"translatedText": translated, "translator": "ctranslate2:en-ru"},
    }


def main():
    for line in sys.stdin:
        text = line.strip()
        if text == "":
            continue
        try:
            message = json.loads(text)
        except json.JSONDecodeError:
            response = error("INVALID_JSON", "Invalid JSON")
        else:
            response = handle(message)
        protocol_out.write(json.dumps(response, ensure_ascii=False) + "\n")
        protocol_out.flush()


if __name__ == "__main__":
    main()
