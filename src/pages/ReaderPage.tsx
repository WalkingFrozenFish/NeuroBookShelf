import { t } from "../i18n";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { confirmAction } from "../confirm";
import { Icon } from "../icons";
import {
  AnnotationMode,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist";
import {
  errorText,
  getDocument as loadDocument,
  readDocumentPdf,
  saveReadingState,
} from "../libraryApi";
import { openPdf } from "../pdfSetup";
import { translateSelectedRegion } from "./ReaderOcr";
import { ReaderPageTranslate } from "./ReaderPageTranslate";
import { ReaderSidePanel } from "./ReaderSidePanel";
import { PageArea, SelectionLayer } from "./SelectionLayer";
import { TranslationOverlay } from "./TranslationOverlay";
import { TranslationBlockRecord } from "../libraryApi";
import { PdfNavigation } from "./PdfNavigation";
import { PdfTextLayer } from "./PdfTextLayer";
import type { PageViewport } from "pdfjs-dist/types/src/display/display_utils";
import type { TextMatch } from "../pdfText";
import { translationQueue } from "../translationQueue";
import { scrollWithinPanel } from "../scrollWithinPanel";
import { pdfAppearances, type Appearance } from "../theme";

const MIN_SCALE = 0.25;
const MAX_SCALE = 4;
const THUMB_MIN = 148;
const THUMB_DEFAULT = THUMB_MIN + 30;
const THUMB_MAX = THUMB_MIN + 200;
const SIDE_MIN = 300;
const SIDE_MAX = SIDE_MIN + 200;

function thumbnailBitmapWidth(columnWidth: number): number {
  const displayed = Math.max(64, columnWidth - 41);
  const density = Math.min(window.devicePixelRatio || 1, 2);
  return Math.min(512, Math.round(displayed * density));
}

type ZoomMode = "fit-width" | "fit-page" | "scale";

type Zoom = {
  mode: ZoomMode;
  value: number;
};

type Props = {
  documentId: number | null;
  appearance: Appearance;
  onAppearance: (appearance: Appearance) => Promise<void>;
  appearancePending: boolean;
  registerLeaveGuard?: (guard: () => boolean | Promise<boolean>) => void;
};

export function ReaderPage({ documentId, registerLeaveGuard, appearance, onAppearance, appearancePending }: Props) {
  const [title, setTitle] = useState("");
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState<Zoom>({ mode: "fit-width", value: 1 });
  const [resolvedScale, setResolvedScale] = useState(1);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selection, setSelection] = useState<PageArea | null>(null);
  const [regionPhase, setRegionPhase] = useState<"idle" | "ocr" | "translating" | "saving">("idle");
  const [regionError, setRegionError] = useState("");
  const regionToken = useRef(0);
  const regionBusy = useRef(false);
  const [highlight, setHighlight] = useState<(PageArea & { id: number }) | null>(null);
  const [blocksVersion, setBlocksVersion] = useState(0);
  const [dictionaryRequest, setDictionaryRequest] = useState(0);
  const [overlay, setOverlay] = useState(false);
  const [soloPopup, setSoloPopup] = useState<number | null>(null);
  const [thumbWidth, setThumbWidth] = useState(THUMB_DEFAULT);
  const [sideWidth, setSideWidth] = useState(SIDE_MAX);
  const [thumbPaintWidth, setThumbPaintWidth] = useState(THUMB_DEFAULT);
  const [pagesOpen, setPagesOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMatch, setSearchMatch] = useState<TextMatch | null>(null);
  const translationRevision = useSyncExternalStore(translationQueue.subscribe, translationQueue.getRevision);
  const openNavigation = useCallback(() => setPagesOpen(true), []);
  const [narrowLayout, setNarrowLayout] = useState(() => window.matchMedia("(max-width: 980px)").matches);
  const queueRef = useRef(Promise.resolve());
  const pageDirtyRef = useRef(false);
  const anyDirtyRef = useRef(false);
  const thumbPixels = thumbnailBitmapWidth(thumbPaintWidth);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setThumbPaintWidth((current) => (current === thumbWidth ? current : thumbWidth));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [thumbWidth]);

  function onColumnResizeStart(
    event: React.PointerEvent<HTMLDivElement>,
    startWidth: number,
    min: number,
    max: number,
    direction: 1 | -1,
    apply: (next: number) => void,
  ) {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    const handle = event.currentTarget;
    const startX = event.clientX;
    const move = (pointerEvent: PointerEvent) => {
      const next = Math.round(Math.min(max, Math.max(min, startWidth + direction * (pointerEvent.clientX - startX))));
      apply(next);
    };
    const stop = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", stop);
      handle.removeEventListener("pointercancel", stop);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      // Указатель уже отпущен или захват недоступен.
    }
  }

  const onDirtyChange = useCallback((pageDirty: boolean, anyDirty: boolean) => {
    pageDirtyRef.current = pageDirty;
    anyDirtyRef.current = anyDirty;
  }, []);

  async function goToPage(next: number) {
    if (next === pageNumber || next < 1 || next > pageCount) {
      return false;
    }
    if (
      pageDirtyRef.current &&
      !(await confirmAction(t("Есть несохранённый текст заметки этой страницы. Перейти без сохранения?")))
    ) {
      return false;
    }
    setPageNumber(next);
    return true;
  }

  function chooseMapPage(next: number) {
    if (!narrowLayout) {
      void goToPage(next);
      return;
    }
    if (next === pageNumber) {
      setPagesOpen(false);
      return;
    }
    void goToPage(next).then((moved) => {
      if (moved) {
        setPagesOpen(false);
      }
    });
  }

  function dismissPageSelection() {
    setSelection(null);
    setSelectionMode(false);
    setHighlight(null);
    window.getSelection()?.removeAllRanges();
  }

  function selectBlock(block: TranslationBlockRecord | (PageArea & { id: number })) {
    setHighlight({
      id: block.id,
      x: "sourceX" in block ? block.sourceX : block.x,
      y: "sourceY" in block ? block.sourceY : block.y,
      width: "sourceWidth" in block ? block.sourceWidth : block.width,
      height: "sourceHeight" in block ? block.sourceHeight : block.height,
    });
  }

  const enqueue = useCallback((job: () => Promise<void>) => {
    const next = queueRef.current.then(job, job);
    queueRef.current = next.then(
      () => undefined,
      () => undefined,
    );
  }, []);

  useEffect(() => {
    if (documentId === null) {
      setPdf(null);
      setError("");
      setLoading(false);
      return;
    }

    let cancelled = false;
    const loadingTask = { current: null as ReturnType<typeof openPdf> | null };
    setLoading(true);
    setError("");
    setPdf(null);
    setPagesOpen(false);
    setSearchQuery("");
    setSearchMatch(null);

    async function open() {
      try {
        const record = await loadDocument(documentId!);
        if (record.deletedAt) {
          throw new Error(t("Документ находится в корзине"));
        }
        if (!record.path) {
          throw new Error(t("У документа нет PDF"));
        }
        const payload = await readDocumentPdf(documentId!);
        if (cancelled) {
          return;
        }
        const task = openPdf(toBytes(payload));
        loadingTask.current = task;
        const document = await task.promise;
        if (cancelled) {
          await document.destroy();
          return;
        }
        const storedPage = clampPage(record.lastPage, document.numPages);
        setTitle(record.title);
        setPageCount(document.numPages);
        setPageNumber(storedPage);
        setZoom(parseZoom(record.lastZoom));
        setPdf(document);
      } catch (loadError: unknown) {
        if (!cancelled) {
          setError(readerError(loadError));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void open();
    return () => {
      cancelled = true;
      void loadingTask.current?.destroy();
      queueRef.current = Promise.resolve();
    };
  }, [documentId]);

  useEffect(() => {
    setSelection(null);
    setHighlight(null);
    setSoloPopup(null);
  }, [documentId, pageNumber]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 980px)");
    function onChange() {
      setNarrowLayout(media.matches);
      if (!media.matches) {
        setPagesOpen(false);
      }
    }
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (!pagesOpen) {
      return;
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setPagesOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pagesOpen]);

  useEffect(() => {
    regionToken.current += 1;
    setRegionError("");
  }, [documentId, pageNumber, selection]);

  async function translateSelection() {
    if (!documentId || !selection || regionBusy.current) {
      return;
    }
    const token = regionToken.current;
    const area = selection;
    const page = pageNumber;
    regionBusy.current = true;
    setRegionError("");
    try {
      const block = await translateSelectedRegion(
        documentId,
        page,
        area,
        (phase) => {
          if (regionToken.current === token) {
            setRegionPhase(phase);
          }
        },
        () => regionToken.current === token,
      );
      if (!block || regionToken.current !== token) {
        return;
      }
      setBlocksVersion((current) => current + 1);
      setSoloPopup(block.id);
      setOverlay(true);
      dismissPageSelection();
    } catch (failure: unknown) {
      if (regionToken.current !== token) {
        return;
      }
      setRegionError(errorText(failure));
    } finally {
      regionBusy.current = false;
      setRegionPhase("idle");
    }
  }

  useEffect(() => {
    if (!registerLeaveGuard) {
      return;
    }
    registerLeaveGuard(() => {
      if (!anyDirtyRef.current) {
        return true;
      }
      return confirmAction(t("Есть несохранённый текст заметки. Уйти без сохранения?"));
    });
    return () => registerLeaveGuard(() => true);
  }, [registerLeaveGuard]);

  useEffect(() => {
    if (!pdf || documentId === null) {
      return;
    }
    const timer = window.setTimeout(() => {
      void saveReadingState(documentId, pageNumber, zoomToStored(zoom)).catch((saveError: unknown) => {
        setError(errorText(saveError));
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [pdf, documentId, pageNumber, zoom]);

  if (documentId === null) {
    return (
      <section className="opening-state">
        <h1>{t("Читалка")}</h1>
        <p>{t("Документ не открыт. Откройте PDF из библиотеки.")}</p>
      </section>
    );
  }

  if (error && !pdf) {
    return (
      <section className="empty-state">
        <h1>{t("Читалка")}</h1>
        <p className="error">{error}</p>
      </section>
    );
  }

  if (!pdf || loading) {
    return (
      <section className="opening-state">
        <h1>{t("Читалка")}</h1>
        <p>{t("Открытие документа…")}</p>
      </section>
    );
  }

  const pageLabel = `${pageNumber} / ${pageCount}`;

  return (
    <section
      className="reader"
      data-document-id={documentId}
      data-reader-page={pageNumber}
      data-reader-pages={pageCount}
      style={{ "--thumb-column": `${thumbWidth}px`, "--side-column": `${sideWidth}px` } as React.CSSProperties}
    >
      <header className="reader-toolbar">
        <strong className="book-name reader-title" title={title}>
          {title}
        </strong>
        <div className="reader-tools" role="toolbar" aria-label={t("Инструменты страницы")}>
          <span className="pdf-appearance-control">
          <select
            className="pdf-appearance-select"
            aria-label={t("Отображение PDF")}
            title={t("Цвета страницы PDF")}
            value={appearance.pdf}
            disabled={appearancePending}
            onChange={(event) => void onAppearance({ ...appearance, pdf: event.target.value as Appearance["pdf"] })}
          >
            {pdfAppearances.map((item) => <option key={item.id} value={item.id}>{t(item.label)}</option>)}
          </select>
          <Icon name="down" />
          </span>
          <button type="button" className={overlay ? "icon-only active" : "icon-only"} aria-label={t("Показать переводы")} title={t("Показать / скрыть переводы")} aria-pressed={overlay} onClick={() => { setOverlay(!overlay); setSoloPopup(null); }}><Icon name="overlay" /></button>
          <button
            type="button"
            className={selectionMode ? "icon-only active" : "icon-only"}
            aria-label={t("Выделить область")}
            title={t("Выделить область")}
            aria-pressed={selectionMode}
            onClick={() =>
              setSelectionMode((current) => {
                if (current) {
                  setSelection(null);
                }
                return !current;
              })
            }
          >
            <Icon name="select" />
          </button>
          <ReaderPageTranslate
            documentId={documentId}
            title={title}
            pageNumber={pageNumber}
            pageCount={pageCount}
          />
        </div>
      </header>
      <aside
        className={pagesOpen ? "thumbs is-open" : "thumbs"}
        aria-label={t("Страницы")}
        aria-hidden={narrowLayout && !pagesOpen ? true : undefined}
        inert={narrowLayout && !pagesOpen ? true : undefined}
      >
        <div className="thumbs-head">
          <strong>{t("Страницы")}</strong>
          <button type="button" className="thumbs-close" aria-label={t("Закрыть карту страниц")} onClick={() => setPagesOpen(false)}>
            <Icon name="clear" />
          </button>
        </div>
        <PdfNavigation pdf={pdf} pageNumber={pageNumber} onOpenPage={goToPage} onMatch={setSearchMatch} onQueryChange={setSearchQuery} onOpenPanel={openNavigation}>
        {Array.from({ length: pageCount }, (_, index) => {
          const number = index + 1;
          return (
            <Thumbnail
              key={number}
              pdf={pdf}
              pageNumber={number}
              active={number === pageNumber}
              pixels={thumbPixels}
              enqueue={enqueue}
              onSelect={chooseMapPage}
            />
          );
        })}
        </PdfNavigation>
        <div
          className="thumbs-resize"
          role="separator"
          aria-orientation="vertical"
          aria-label={t("Ширина превью")}
          aria-valuemin={THUMB_MIN}
          aria-valuemax={THUMB_MAX}
          aria-valuenow={thumbWidth}
          title={t("Потяните, чтобы изменить ширину")}
          onPointerDown={(event) => onColumnResizeStart(event, thumbWidth, THUMB_MIN, THUMB_MAX, 1, setThumbWidth)}
        >
          ⋮
        </div>
      </aside>
      <div className="page-stage">
        <button
          type="button"
          className="pages-toggle"
          aria-label={t("Карта страниц")}
          aria-expanded={pagesOpen}
          onClick={() => setPagesOpen(true)}
        >
          <Icon name="page" />
          <span className="sr-only">{t("Карта страниц")}</span>
        </button>
        {pagesOpen ? (
          <button
            type="button"
            className="pages-backdrop"
            aria-label={t("Закрыть карту страниц")}
            onClick={() => setPagesOpen(false)}
          />
        ) : null}
        <div className="reader-notices">
          {error ? (
            <div className="reader-notice is-error" role="status">
              <p>{error}</p>
              <button type="button" className="reader-notice-close" aria-label={t("Закрыть")} onClick={() => setError("")}>
                <Icon name="clear" />
              </button>
            </div>
          ) : null}
        </div>
        <PageView
          pdf={pdf}
          documentId={documentId}
          pageNumber={pageNumber}
          zoom={zoom}
          searchQuery={searchQuery}
          searchMatch={searchMatch}
          onScale={setResolvedScale}
          selectionMode={selectionMode}
          selection={selection}
          onSelect={setSelection}
          translateLabel={regionLabel(regionPhase)}
          translateError={regionError}
          translateDisabled={regionPhase !== "idle"}
          onTranslate={() => void translateSelection()}
          highlight={highlight}
          overlay={overlay}
          blocksVersion={blocksVersion + translationRevision}
          highlightedId={highlight?.id ?? null}
          soloPopup={soloPopup}
          onOverlaySelect={selectBlock}
          onPopupCollapsed={(id) => setHighlight((current) => (current?.id === id ? null : current))}
          onPopupSaved={() => setBlocksVersion((current) => current + 1)}
          onAddedToDictionary={() => setDictionaryRequest((current) => current + 1)}
          onTogglePopups={() => {
            setOverlay((current) => !current);
            setSoloPopup(null);
            setHighlight(null);
          }}
        />
        <div className="viewer-bar" aria-label={t("Просмотр страницы")}>
          <button
            type="button"
            aria-label={t("Назад")}
            title={t("Предыдущая страница")}
            disabled={pageNumber <= 1}
            onClick={() => goToPage(pageNumber - 1)}
          >
            <Icon name="back" />
            <span className="sr-only">{t("Назад")}</span>
          </button>
          <span className="page-label">{pageLabel}</span>
          <button
            type="button"
            aria-label={t("Вперёд")}
            title={t("Следующая страница")}
            disabled={pageNumber >= pageCount}
            onClick={() => goToPage(pageNumber + 1)}
          >
            <Icon name="forward" />
            <span className="sr-only">{t("Вперёд")}</span>
          </button>
          <span className="viewer-split" aria-hidden="true" />
          <button type="button" aria-label={t("Уменьшить")} title={t("Уменьшить")} onClick={() => setZoom(stepZoom(resolvedScale, 1 / 1.25))}>
            <Icon name="minus" />
            <span className="sr-only">−</span>
          </button>
          <ZoomPercent
            scale={resolvedScale}
            mode={zoom.mode}
            onCommit={(value) => setZoom({ mode: "scale", value })}
          />
          <button type="button" aria-label={t("Увеличить")} title={t("Увеличить")} onClick={() => setZoom(stepZoom(resolvedScale, 1.25))}>
            <Icon name="plus" />
            <span className="sr-only">+</span>
          </button>
          <span className="viewer-split" aria-hidden="true" />
          <button
            type="button"
            className={zoom.mode === "fit-width" ? "active" : undefined}
            aria-label={t("По ширине")}
            title={t("По ширине")}
            aria-pressed={zoom.mode === "fit-width"}
            onClick={() => setZoom({ mode: "fit-width", value: resolvedScale })}
          >
            <Icon name="width" />
            <span className="sr-only">{t("По ширине")}</span>
          </button>
          <button
            type="button"
            className={zoom.mode === "fit-page" ? "active" : undefined}
            aria-label={t("Страница")}
            title={t("Страница целиком")}
            aria-pressed={zoom.mode === "fit-page"}
            onClick={() => setZoom({ mode: "fit-page", value: resolvedScale })}
          >
            <Icon name="page" />
            <span className="sr-only">{t("Страница")}</span>
          </button>
        </div>
      </div>
      <ReaderSidePanel
        width={sideWidth}
        onResizeStart={(event) => onColumnResizeStart(event, sideWidth, SIDE_MIN, SIDE_MAX, -1, setSideWidth)}
        documentId={documentId}
        pageNumber={pageNumber}
        onOpenPage={goToPage}
        onDirtyChange={onDirtyChange}
        blocksVersion={blocksVersion + translationRevision}
        highlightedId={highlight?.id ?? null}
        onHighlight={selectBlock}
        onShowOverlay={() => {
          setSoloPopup(null);
          setOverlay(true);
        }}
        onShowPopup={(id) => {
          setSoloPopup(id);
          setOverlay(true);
        }}
        onBlocksChanged={() => setBlocksVersion((current) => current + 1)}
        dictionaryRequest={dictionaryRequest}
      />
    </section>
  );
}

function PageView({
  pdf,
  documentId,
  pageNumber,
  zoom,
  searchQuery,
  searchMatch,
  onScale,
  selectionMode,
  selection,
  onSelect,
  translateLabel,
  translateError,
  translateDisabled,
  onTranslate,
  highlight,
  overlay,
  blocksVersion,
  highlightedId,
  soloPopup,
  onOverlaySelect,
  onPopupCollapsed,
  onPopupSaved,
  onAddedToDictionary,
  onTogglePopups,
}: {
  pdf: PDFDocumentProxy;
  documentId: number;
  pageNumber: number;
  zoom: Zoom;
  searchQuery: string;
  searchMatch: TextMatch | null;
  onScale: (scale: number) => void;
  selectionMode: boolean;
  selection: PageArea | null;
  onSelect: (area: PageArea) => void;
  translateLabel: string;
  translateError: string;
  translateDisabled: boolean;
  onTranslate: () => void;
  highlight: (PageArea & { id: number }) | null;
  overlay: boolean;
  blocksVersion: number;
  highlightedId: number | null;
  soloPopup: number | null;
  onOverlaySelect: (block: TranslationBlockRecord) => void;
  onPopupCollapsed: (id: number) => void;
  onPopupSaved: () => void;
  onAddedToDictionary: () => void;
  onTogglePopups: () => void;
}) {
  const viewRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [pageError, setPageError] = useState("");
  const [textViewport, setTextViewport] = useState<{ pageNumber: number; viewport: PageViewport } | null>(null);
  const [rendered, setRendered] = useState<{
    pdf: PDFDocumentProxy;
    pageNumber: number;
    zoom: Zoom;
    width: number;
    height: number;
  } | null>(null);
  const isRendered = rendered?.pdf === pdf && rendered.pageNumber === pageNumber &&
    rendered.zoom === zoom && rendered.width === box.width && rendered.height === box.height;

  useEffect(() => {
    const node = viewRef.current;
    if (!node) {
      return;
    }
    const measure = () => {
      const width = node.clientWidth;
      const height = node.clientHeight;
      setBox((current) => (current.width === width && current.height === height ? current : { width, height }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || box.width < 40 || box.height < 40) {
      return;
    }
    const state = { cancelled: false, task: null as RenderTask | null };
    setPageError("");
    setTextViewport(null);
    setRendered(null);

    async function draw() {
      const page = await pdf.getPage(pageNumber);
      if (state.cancelled) {
        page.cleanup();
        return;
      }
      const base = page.getViewport({ scale: 1 });
      const view = viewRef.current;
      const styles = view ? getComputedStyle(view) : null;
      const padX = styles ? Number.parseFloat(styles.paddingLeft) + Number.parseFloat(styles.paddingRight) : 40;
      const padY = styles ? Number.parseFloat(styles.paddingTop) + Number.parseFloat(styles.paddingBottom) : 40;
      const availableWidth = Math.max(box.width - padX, 40);
      const availableHeight = Math.max(box.height - padY, 40);
      const scale = resolveScale(zoom, base.width, base.height, availableWidth, availableHeight);
      if (state.cancelled) {
        page.cleanup();
        return;
      }
      onScale(scale);
      const css = page.getViewport({ scale });
      const fitted = fitPageBox(zoom.mode, css.width, css.height, availableWidth, availableHeight);
      const outputScale = cappedRatio(fitted.width, fitted.height);
      const viewport = page.getViewport({ scale: scale * outputScale });
      canvas!.width = Math.ceil(viewport.width);
      canvas!.height = Math.ceil(viewport.height);
      canvas!.style.width = `${fitted.width}px`;
      canvas!.style.height = `${fitted.height}px`;
      if (view && zoom.mode !== "scale") {
        trimPageToView(view, canvas!, zoom.mode === "fit-page" || fitted.height <= availableHeight);
      }
      state.task = page.render({ canvas: canvas!, viewport, annotationMode: AnnotationMode.ENABLE });
      try {
        await state.task.promise;
        if (!state.cancelled) {
          setTextViewport({ pageNumber, viewport: page.getViewport({ scale: Number.parseFloat(canvas!.style.width) / base.width }) });
          setRendered({ pdf, pageNumber, zoom, width: box.width, height: box.height });
        }
      } catch (renderError: unknown) {
        if (!state.cancelled && !isCancelledRender(renderError)) {
          setPageError(t("Не удалось показать страницу"));
        }
      } finally {
        page.cleanup();
      }
    }

    void draw().catch((failure) => { if (!state.cancelled) setPageError(errorText(failure)); });
    return () => {
      state.cancelled = true;
      state.task?.cancel();
    };
  }, [pdf, pageNumber, zoom, box.width, box.height, onScale]);

  return (
    <div className="page-view" data-zoom={zoom.mode} ref={viewRef}>
      <div
        className="page-frame"
        data-rendering={!isRendered}
        aria-busy={!isRendered && !pageError}
        onClick={(event) => {
          if (!isRendered || selectionMode) {
            return;
          }
          const target = event.target;
          if (!(target instanceof Element)) {
            return;
          }
          if (target.closest(".translation-popup, .selection-actions, .pdf-text-layer span") || window.getSelection()?.toString()) {
            return;
          }
          onTogglePopups();
        }}
      >
        <canvas ref={canvasRef} />
        {textViewport?.pageNumber === pageNumber && <PdfTextLayer key={`${documentId}-${pageNumber}`} pdf={pdf} pageNumber={pageNumber} viewport={textViewport.viewport} query={searchQuery} activeMatch={searchMatch} onError={setPageError} />}
        <SelectionLayer
          key={pageNumber}
          active={selectionMode}
          selection={selection}
          onSelect={onSelect}
          translateLabel={translateLabel}
          translateError={translateError}
          translateDisabled={translateDisabled}
          onTranslate={onTranslate}
        />
        {highlight ? (
          <div
            className="saved-highlight"
            data-highlight-id={highlight.id}
            data-highlight-x={highlight.x}
            data-highlight-y={highlight.y}
            data-highlight-width={highlight.width}
            data-highlight-height={highlight.height}
            style={{
              left: `${highlight.x * 100}%`,
              top: `${highlight.y * 100}%`,
              width: `${highlight.width * 100}%`,
              height: `${highlight.height * 100}%`,
            }}
          />
        ) : null}
        {overlay ? (
          <TranslationOverlay
            documentId={documentId}
            pageNumber={pageNumber}
            blocksVersion={blocksVersion}
            highlightedId={highlightedId}
            soloId={soloPopup}
            onSelect={onOverlaySelect}
            onCollapse={onPopupCollapsed}
            onSaved={onPopupSaved}
            onAddedToDictionary={onAddedToDictionary}
          />
        ) : null}
      </div>
      {pageError ? <p className="error">{pageError}</p> : null}
    </div>
  );
}

function Thumbnail({
  pdf,
  pageNumber,
  active,
  pixels,
  enqueue,
  onSelect,
}: {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  active: boolean;
  pixels: number;
  enqueue: (job: () => Promise<void>) => void;
  onSelect: (pageNumber: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!active) {
      return;
    }
    const button = buttonRef.current;
    const panel = button?.closest<HTMLElement>(".thumbs-scroll");
    if (button && panel) scrollWithinPanel(button, panel);
  }, [active]);

  useEffect(() => {
    const button = buttonRef.current;
    const root = button?.closest(".thumbs-scroll");
    if (!button || !(root instanceof Element)) {
      setReady(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setReady(true);
        }
      },
      { root, rootMargin: "700px 0px" },
    );
    observer.observe(button);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void pdf.getPage(pageNumber).then((page) => {
      const viewport = page.getViewport({ scale: 1 });
      if (!cancelled && canvasRef.current) {
        canvasRef.current.style.aspectRatio = `${viewport.width} / ${viewport.height}`;
      }
      page.cleanup();
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [pdf, pageNumber]);

  useEffect(() => {
    if (!ready) {
      return;
    }
    const state = { cancelled: false, task: null as RenderTask | null };
    void enqueue(async () => {
      const canvas = canvasRef.current;
      if (!canvas || state.cancelled) {
        return;
      }
      const page = await pdf.getPage(pageNumber);
      if (state.cancelled) {
        page.cleanup();
        return;
      }
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: pixels / base.width });
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      state.task = page.render({
        canvas,
        viewport,
        annotationMode: AnnotationMode.DISABLE,
      });
      try {
        await state.task.promise;
      } catch (renderError: unknown) {
        if (!state.cancelled && !isCancelledRender(renderError)) {
          canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
        }
      } finally {
        page.cleanup();
      }
    });
    return () => {
      state.cancelled = true;
      state.task?.cancel();
    };
  }, [pdf, pageNumber, enqueue, ready, pixels]);

  return (
    <button
      ref={buttonRef}
      type="button"
      className={active ? "thumb active" : "thumb"}
      aria-current={active ? "page" : undefined}
      onClick={() => onSelect(pageNumber)}
    >
      <canvas ref={canvasRef} />
      <span>{pageNumber}</span>
    </button>
  );
}

function regionLabel(phase: "idle" | "ocr" | "translating" | "saving"): string {
  if (phase === "ocr") {
    return t("Распознавание…");
  }
  if (phase === "translating") {
    return t("Перевод…");
  }
  if (phase === "saving") {
    return t("Сохранение…");
  }
  return t("Перевести");
}

function ZoomPercent({
  scale,
  mode,
  onCommit,
}: {
  scale: number;
  mode: ZoomMode;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelRef = useRef(false);
  const percent = Math.round(scale * 100);

  function commit(raw: string) {
    const text = raw.replace(",", ".").trim();
    const parsed = Number(text);
    if (text === "" || !Number.isFinite(parsed)) {
      return;
    }
    const next = clampScale(parsed / 100);
    if (Math.round(next * 100) === percent) {
      return;
    }
    onCommit(next);
  }

  return (
    <label className="zoom-label" data-scale={scale.toFixed(3)} data-zoom={mode}>
      <input
        aria-label={t("Масштаб")}
        title={t("Масштаб от 25 до 400")}
        inputMode="decimal"
        value={draft ?? String(percent)}
        onFocus={(event) => {
          const input = event.currentTarget;
          cancelRef.current = false;
          setDraft(String(percent));
          requestAnimationFrame(() => input.select());
        }}
        onChange={(event) => setDraft(event.target.value.replace(/[^\d.,]/g, ""))}
        onBlur={(event) => {
          if (cancelRef.current) {
            cancelRef.current = false;
            setDraft(null);
            return;
          }
          commit(event.currentTarget.value);
          setDraft(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }
          if (event.key === "Escape") {
            cancelRef.current = true;
            setDraft(null);
            event.currentTarget.blur();
          }
        }}
      />
      <span aria-hidden="true">%</span>
    </label>
  );
}

function fitPageBox(
  mode: ZoomMode,
  width: number,
  height: number,
  availableWidth: number,
  availableHeight: number,
): { width: number; height: number } {
  const nudge =
    mode === "fit-page" ? Math.min(1, availableWidth / width, availableHeight / height) : 1;
  return {
    width: Math.max(1, Math.floor(width * nudge)),
    height: Math.max(1, Math.floor(height * nudge)),
  };
}

function trimPageToView(view: HTMLElement, canvas: HTMLCanvasElement, allowY: boolean) {
  for (let step = 0; step < 3; step += 1) {
    const extraX = view.scrollWidth - view.clientWidth;
    const extraY = allowY ? view.scrollHeight - view.clientHeight : 0;
    if (extraX <= 0 && extraY <= 0) {
      return;
    }
    const width = Number.parseFloat(canvas.style.width);
    const height = Number.parseFloat(canvas.style.height);
    if (!(width > 0) || !(height > 0)) {
      return;
    }
    const factor = Math.min(
      extraX > 0 ? (width - extraX) / width : 1,
      extraY > 0 ? (height - extraY) / height : 1,
    );
    if (!(factor > 0) || factor >= 1) {
      return;
    }
    canvas.style.width = `${Math.max(1, Math.floor(width * factor))}px`;
    canvas.style.height = `${Math.max(1, Math.floor(height * factor))}px`;
  }
}

function resolveScale(
  zoom: Zoom,
  pageWidth: number,
  pageHeight: number,
  availableWidth: number,
  availableHeight: number,
): number {
  const widthScale = availableWidth / pageWidth;
  const heightScale = availableHeight / pageHeight;
  if (zoom.mode === "fit-width") {
    return clampScale(widthScale);
  }
  if (zoom.mode === "fit-page") {
    return clampScale(Math.min(widthScale, heightScale));
  }
  return clampScale(zoom.value);
}

function stepZoom(current: number, factor: number): Zoom {
  return { mode: "scale", value: clampScale(current * factor) };
}

function clampScale(value: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

function clampPage(page: number, pageCount: number): number {
  if (!Number.isFinite(page) || page < 1) {
    return 1;
  }
  return Math.min(Math.floor(page), pageCount);
}

function cappedRatio(width: number, height: number): number {
  let ratio = Math.min(window.devicePixelRatio || 1, 2);
  const limit = 2400;
  if (width * ratio > limit) {
    ratio = limit / width;
  }
  if (height * ratio > limit) {
    ratio = Math.min(ratio, limit / height);
  }
  return Math.max(ratio, 1);
}

function parseZoom(value: string): Zoom {
  if (value === "fit-width" || value === "fit-page") {
    return { mode: value, value: 1 };
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return { mode: "fit-width", value: 1 };
  }
  return { mode: "scale", value: clampScale(parsed) };
}

function zoomToStored(zoom: Zoom): string {
  if (zoom.mode === "scale") {
    return zoom.value.toFixed(3);
  }
  return zoom.mode;
}

function toBytes(payload: ArrayBuffer | number[] | Uint8Array): Uint8Array {
  if (payload instanceof Uint8Array) {
    return new Uint8Array(payload);
  }
  if (payload instanceof ArrayBuffer) {
    return new Uint8Array(payload);
  }
  return Uint8Array.from(payload);
}

function readerError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "InvalidPDFException" || error.name === "MissingPDFException") {
      return t("Не удалось открыть PDF. Файл повреждён или имеет неподдерживаемый формат.");
    }
    if (error.name === "PasswordException") {
      return t("PDF защищён паролем. Открытие таких файлов пока недоступно.");
    }
  }
  return errorText(error);
}

function isCancelledRender(error: unknown): boolean {
  return error instanceof Error && error.name === "RenderingCancelledException";
}
