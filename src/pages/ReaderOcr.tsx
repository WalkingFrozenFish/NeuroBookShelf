import { t } from "../i18n";
import {
  createTranslationBlock,
  ocrDocumentRegion,
  OcrResult,
  translateText,
  TranslationBlockRecord,
  TranslationResult,
} from "../libraryApi";
import { PageArea } from "./SelectionLayer";

export async function translateSelectedRegion(
  documentId: number,
  pageNumber: number,
  selection: PageArea,
  onPhase: (phase: "ocr" | "translating" | "saving") => void,
  isCurrent: () => boolean,
): Promise<TranslationBlockRecord | null> {
  onPhase("ocr");
  const recognized = await ocrDocumentRegion(documentId, pageNumber, selection);
  if (!isCurrent()) {
    return null;
  }
  if (!recognized.success || !isOcrResult(recognized.result)) {
    const code = recognized.error?.code ?? "OCR_ERROR";
    const message = recognized.error?.message ?? t("Не удалось распознать текст");
    throw new Error(`${code}: ${message}`);
  }
  const text = recognized.result.text.trim();
  if (text === "") {
    throw new Error(t("Текст не найден."));
  }

  onPhase("translating");
  const response = await translateText(text);
  if (!isCurrent()) {
    return null;
  }
  if (!response.success || !isTranslationResult(response.result)) {
    const code = response.error?.code ?? "TRANSLATION_ERROR";
    const message = response.error?.message ?? t("Не удалось перевести текст");
    throw new Error(`${code}: ${message}`);
  }
  if (response.result.alreadyTarget) return null;
  const translated = response.result.translatedText.trim();
  if (translated === "") {
    throw new Error(t("Перевод пустой."));
  }

  if (!isCurrent()) {
    return null;
  }
  onPhase("saving");
  return createTranslationBlock(
    documentId,
    pageNumber,
    selection,
    text,
    translated,
    response.result.translator ?? "ctranslate2:en-ru",
  );
}

function isTranslationResult(value: unknown): value is TranslationResult {
  if (!value || typeof value !== "object") {
    return false;
  }
  return typeof (value as TranslationResult).translatedText === "string";
}

function isOcrResult(value: unknown): value is OcrResult {
  if (!value || typeof value !== "object") {
    return false;
  }
  const result = value as OcrResult;
  return typeof result.text === "string" && Array.isArray(result.blocks);
}
