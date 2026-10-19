import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../icons";
import {
  analyzeDocumentPage,
  createTranslationBlock,
  errorText,
  listTranslationBlocks,
  ocrDocumentPage,
  PageAnalysis,
  PageOcrBlock,
  TextBlock,
  translateText,
  TranslationBlockRecord,
  TranslationResult,
} from "../libraryApi";

type Phase = "idle" | "analyzing" | "ocr" | "translating" | "saving" | "done" | "already" | "error";

type BlockError = {
  text: string;
  message: string;
};

type SourceBlock = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export function ReaderPageTranslate({
  documentId,
  pageNumber,
  onBlocksChanged,
  onShowOverlay,
  onTranslated,
}: {
  documentId: number;
  pageNumber: number;
  onBlocksChanged: () => void;
  onShowOverlay: () => void;
  onTranslated: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [detail, setDetail] = useState("");
  const [savedCount, setSavedCount] = useState(0);
  const [skippedCount, setSkippedCount] = useState(0);
  const [failures, setFailures] = useState<BlockError[]>([]);
  const generation = useRef(0);
  const [noticeHost, setNoticeHost] = useState<HTMLElement | null>(null);
  const running = phase === "analyzing" || phase === "ocr" || phase === "translating" || phase === "saving";

  useEffect(() => {
    setNoticeHost(document.querySelector(".reader-notices"));
  }, [phase]);

  useEffect(() => {
    if ((phase !== "done" && phase !== "already") || failures.length > 0) {
      return;
    }
    const timer = window.setTimeout(() => {
      setPhase("idle");
      setDetail("");
    }, 4200);
    return () => window.clearTimeout(timer);
  }, [phase, failures.length]);

  useEffect(() => {
    generation.current += 1;
    setPhase("idle");
    setDetail("");
    setSavedCount(0);
    setSkippedCount(0);
    setFailures([]);
  }, [documentId, pageNumber]);

  async function translatePage() {
    if (running) {
      return;
    }
    const token = generation.current;
    const page = pageNumber;
    setFailures([]);
    setSavedCount(0);
    setSkippedCount(0);
    setDetail("");
    setPhase("analyzing");
    try {
      const existing = await listTranslationBlocks(documentId, page);
      if (generation.current !== token) {
        return;
      }
      if (existing.length > 0) {
        onShowOverlay();
      }
      const sources = await collectSources(documentId, page, token, generation, setPhase);
      if (generation.current !== token || sources === null) {
        return;
      }
      const fresh = sources.filter((block) => !existing.some((saved) => sameArea(block, saved)));
      const skipped = sources.length - fresh.length;
      setSkippedCount(skipped);
      if (fresh.length === 0) {
        setPhase(sources.length === 0 ? "error" : "already");
        setDetail(
          sources.length === 0
            ? "Текст на странице не найден."
            : "Страница уже переведена. Повторный перевод не запущен.",
        );
        return;
      }
      const problems: BlockError[] = [];
      let saved = 0;
      for (let index = 0; index < fresh.length; index += 1) {
        if (generation.current !== token) {
          return;
        }
        const block = fresh[index];
        setPhase("translating");
        setDetail(`Перевод блоков: ${index + 1} из ${fresh.length}`);
        try {
          const response = await translateText(block.text);
          if (generation.current !== token) {
            return;
          }
          if (!response.success || !isTranslationResult(response.result)) {
            const code = response.error?.code ?? "TRANSLATION_ERROR";
            const message = response.error?.message ?? "Не удалось перевести текст";
            problems.push({ text: block.text, message: `${code}: ${message}` });
            continue;
          }
          const translated = response.result.translatedText.trim();
          if (translated === "") {
            problems.push({ text: block.text, message: "EMPTY_TEXT: Перевод пустой" });
            continue;
          }
          setPhase("saving");
          setDetail(`Сохранение: ${index + 1} из ${fresh.length}`);
          await createTranslationBlock(
            documentId,
            page,
            block,
            block.text,
            translated,
            response.result.translator ?? "ctranslate2:en-ru",
          );
          saved += 1;
          setSavedCount(saved);
          onBlocksChanged();
          onShowOverlay();
          onTranslated();
        } catch (failure: unknown) {
          problems.push({ text: block.text, message: errorText(failure) });
        }
      }
      if (generation.current !== token) {
        return;
      }
      setFailures(problems);
      setPhase(saved === 0 && problems.length > 0 ? "error" : "done");
      setDetail(
        `Сохранено: ${saved}. Пропущено: ${skipped}. Ошибок: ${problems.length}.`,
      );
    } catch (failure: unknown) {
      if (generation.current !== token) {
        return;
      }
      setPhase("error");
      setDetail(errorText(failure));
    }
  }

  function dismissNotice() {
    setPhase("idle");
    setDetail("");
    setFailures([]);
    setSavedCount(0);
    setSkippedCount(0);
  }

  const progress = progressHint(phase, detail);
  const notice =
    running || phase === "idle" ? null : (
      <div
        className={phase === "error" ? "reader-notice is-error" : "reader-notice"}
        role="status"
        data-page-translate-state={phase}
        data-page-translate-saved={savedCount}
        data-page-translate-skipped={skippedCount}
        data-page-translate-failed={failures.length}
      >
        <p>
          <span>
            {phaseLabel(phase)}
            {detail ? ` ${detail}` : ""}
          </span>
        </p>
        {failures.length > 0 ? (
          <ul className="page-translate-errors" data-page-translate-errors="">
            {failures.map((failure) => (
              <li key={`${failure.text}-${failure.message}`}>
                {`${preview(failure.text)} — ${failure.message}`}
              </li>
            ))}
          </ul>
        ) : null}
        <button type="button" className="reader-notice-close" aria-label="Закрыть" onClick={dismissNotice}>
          <Icon name="clear" />
        </button>
      </div>
    );

  return (
    <div className="page-translate">
      <button
        type="button"
        className={running ? "icon-only is-busy" : "icon-only"}
        aria-label="Перевести страницу"
        title={running ? undefined : "Перевести страницу"}
        data-progress={running ? progress : undefined}
        aria-busy={running}
        aria-disabled={running}
        onClick={() => void translatePage()}
      >
        {running ? <span className="notice-spinner" aria-hidden="true" /> : <Icon name="translate" />}
        <span className="sr-only">Перевести страницу</span>
      </button>
      {notice && noticeHost ? createPortal(notice, noticeHost) : null}
    </div>
  );
}

async function collectSources(
  documentId: number,
  pageNumber: number,
  token: number,
  generation: { current: number },
  setPhase: (phase: Phase) => void,
): Promise<SourceBlock[] | null> {
  const response = await analyzeDocumentPage(documentId, pageNumber);
  if (generation.current !== token) {
    return null;
  }
  if (!response.success || !isPageAnalysis(response.result)) {
    const code = response.error?.code ?? "PDF_ERROR";
    const message = response.error?.message ?? "Не удалось прочитать страницу";
    throw new Error(`${code}: ${message}`);
  }
  const textBlocks = usableTextBlocks(response.result);
  if (textBlocks) {
    return textBlocks;
  }
  setPhase("ocr");
  const ocr = await ocrDocumentPage(documentId, pageNumber);
  if (generation.current !== token) {
    return null;
  }
  if (!ocr.success || !isPageOcr(ocr.result)) {
    const code = ocr.error?.code ?? "OCR_ERROR";
    const message = ocr.error?.message ?? "Не удалось распознать страницу";
    throw new Error(`${code}: ${message}`);
  }
  return ocr.result.blocks.filter(isSourceBlock);
}

function usableTextBlocks(page: PageAnalysis): SourceBlock[] | null {
  if (!page.hasTextLayer) {
    return null;
  }
  const blocks = page.blocks.filter(isSourceBlock);
  return blocks.length > 0 ? blocks : null;
}

function isSourceBlock(value: TextBlock | PageOcrBlock): value is SourceBlock {
  return (
    typeof value.text === "string" &&
    value.text.trim() !== "" &&
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    Number.isFinite(value.width) &&
    Number.isFinite(value.height) &&
    value.width > 0 &&
    value.height > 0 &&
    value.x >= 0 &&
    value.y >= 0 &&
    value.x <= 1 &&
    value.y <= 1 &&
    value.x + value.width <= 1.001 &&
    value.y + value.height <= 1.001
  );
}

function sameArea(block: SourceBlock, saved: TranslationBlockRecord): boolean {
  const left = Math.max(block.x, saved.sourceX);
  const top = Math.max(block.y, saved.sourceY);
  const right = Math.min(block.x + block.width, saved.sourceX + saved.sourceWidth);
  const bottom = Math.min(block.y + block.height, saved.sourceY + saved.sourceHeight);
  const width = right - left;
  const height = bottom - top;
  if (width <= 0 || height <= 0) {
    return false;
  }
  const intersection = width * height;
  const union = block.width * block.height + saved.sourceWidth * saved.sourceHeight - intersection;
  return union > 0 && intersection / union >= 0.55;
}

function isPageAnalysis(value: unknown): value is PageAnalysis {
  if (!value || typeof value !== "object") {
    return false;
  }
  const page = value as PageAnalysis;
  return typeof page.hasTextLayer === "boolean" && Array.isArray(page.blocks);
}

function isPageOcr(value: unknown): value is { blocks: PageOcrBlock[] } {
  if (!value || typeof value !== "object") {
    return false;
  }
  return Array.isArray((value as { blocks?: unknown }).blocks);
}

function isTranslationResult(value: unknown): value is TranslationResult {
  if (!value || typeof value !== "object") {
    return false;
  }
  return typeof (value as TranslationResult).translatedText === "string";
}

function progressHint(phase: Phase, detail: string): string {
  if (detail.trim() !== "") {
    return detail;
  }
  return phaseLabel(phase);
}

function phaseLabel(phase: Phase): string {
  if (phase === "analyzing") {
    return "Анализ страницы…";
  }
  if (phase === "ocr") {
    return "Распознавание страницы…";
  }
  if (phase === "translating") {
    return "Перевод блоков…";
  }
  if (phase === "saving") {
    return "Сохранение…";
  }
  if (phase === "already") {
    return "Готово.";
  }
  if (phase === "done") {
    return "Готово.";
  }
  return "Ошибка.";
}

function preview(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > 80 ? `${compact.slice(0, 80)}…` : compact;
}
