import { PointerEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "../icons";
import {
  createDictionaryEntry,
  errorText,
  listTranslationBlocks,
  TranslationBlockRecord,
  updateTranslationPopup,
} from "../libraryApi";
import { PageArea } from "./SelectionLayer";

const DEFAULT_WIDTH = 0.28;
const DEFAULT_HEIGHT = 0.16;
const RESIZE_EDGES = ["n", "e", "s", "w", "ne", "nw", "se", "sw"] as const;

type ResizeEdge = (typeof RESIZE_EDGES)[number];

type Gesture = {
  id: number;
  mode: "drag" | "resize";
  edge: ResizeEdge | null;
  startPointer: { x: number; y: number };
  startBox: PageArea;
  box: PageArea;
  openOnClick: boolean;
  moved: boolean;
};

export function TranslationOverlay({
  documentId,
  pageNumber,
  blocksVersion,
  highlightedId,
  soloId,
  onSelect,
  onCollapse,
  onSaved,
  onAddedToDictionary,
}: {
  documentId: number;
  pageNumber: number;
  blocksVersion: number;
  highlightedId: number | null;
  soloId: number | null;
  onSelect: (block: TranslationBlockRecord) => void;
  onCollapse: (id: number) => void;
  onSaved: () => void;
  onAddedToDictionary: () => void;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const [blocks, setBlocks] = useState<TranslationBlockRecord[]>([]);
  const [drafts, setDrafts] = useState<Record<number, PageArea>>({});
  const [openIds, setOpenIds] = useState<number[]>([]);
  const [error, setError] = useState("");
  const [savingIds, setSavingIds] = useState<number[]>([]);
  const [savedIds, setSavedIds] = useState<number[]>([]);

  useEffect(() => {
    setOpenIds([]);
    setDrafts({});
  }, [documentId, pageNumber]);

  useLayoutEffect(() => {
    const layer = layerRef.current;
    if (!layer) {
      return;
    }
    const place = () => keepFittedPopupsInside(layer);
    place();
    const observer = new ResizeObserver(place);
    observer.observe(layer);
    return () => observer.disconnect();
  }, [blocks, openIds, drafts]);

  useEffect(() => {
    if (soloId === null) {
      return;
    }
    setOpenIds((current) => (current.includes(soloId) ? current : [...current, soloId]));
  }, [soloId]);

  useEffect(() => {
    let active = true;
    listTranslationBlocks(documentId, pageNumber)
      .then((list) => {
        if (active) {
          setBlocks(list);
          setError("");
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(errorText(loadError));
        }
      });
    return () => {
      active = false;
    };
  }, [documentId, pageNumber, blocksVersion]);

  function pointFrom(event: PointerEvent<HTMLElement>) {
    const rect = layerRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return { x: 0, y: 0 };
    }
    return {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    };
  }

  function sizeLimits() {
    const rect = layerRef.current?.getBoundingClientRect();
    return {
      minWidth: rect && rect.width > 0 ? Math.min(1, Math.max(0.08, 120 / rect.width)) : 0.08,
      minHeight: rect && rect.height > 0 ? Math.min(1, Math.max(0.06, 64 / rect.height)) : 0.06,
    };
  }

  function clampBox(box: PageArea): PageArea {
    const { minWidth, minHeight } = sizeLimits();
    const width = round4(Math.min(Math.max(box.width, minWidth), 1));
    const height = round4(Math.min(Math.max(box.height, minHeight), 1));
    return {
      x: round4(Math.min(Math.max(box.x, 0), 1 - width)),
      y: round4(Math.min(Math.max(box.y, 0), 1 - height)),
      width,
      height,
    };
  }

  function onPointerDown(event: PointerEvent<HTMLElement>, block: TranslationBlockRecord) {
    if (event.button !== 0) {
      return;
    }
    const target = event.target as HTMLElement;
    if (target.closest("[data-popup-collapse], [data-popup-dictionary]")) {
      return;
    }
    onSelect(block);
    const edge = resizeEdge(target);
    const mode = edge ? "resize" : target.closest("[data-popup-drag], [data-popup-icon]") ? "drag" : null;
    if (!mode) {
      return;
    }
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* An untrusted test event cannot capture the pointer. */
    }
    const startBox = boxFor(block, event.currentTarget);
    gestureRef.current = {
      id: block.id,
      mode,
      edge,
      startPointer: pointFrom(event),
      startBox,
      box: startBox,
      openOnClick: Boolean(target.closest("[data-popup-icon]")),
      moved: false,
    };
  }

  function onPointerMove(event: PointerEvent<HTMLElement>) {
    const gesture = gestureRef.current;
    if (!gesture) {
      return;
    }
    const point = pointFrom(event);
    const dx = point.x - gesture.startPointer.x;
    const dy = point.y - gesture.startPointer.y;
    if (Math.abs(dx) > 0.006 || Math.abs(dy) > 0.006) {
      gesture.moved = true;
    }
    if (gesture.openOnClick) {
      return;
    }
    const { minWidth, minHeight } = sizeLimits();
    const next =
      gesture.mode === "drag"
        ? { ...gesture.startBox, x: gesture.startBox.x + dx, y: gesture.startBox.y + dy }
        : resizeFromEdge(gesture.startBox, dx, dy, gesture.edge ?? "se", minWidth, minHeight);
    const box = gesture.mode === "drag" ? clampBox(next) : next;
    gesture.box = box;
    setDrafts((current) => ({ ...current, [gesture.id]: box }));
  }

  function onPointerUp() {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (!gesture) {
      return;
    }
    if (gesture.openOnClick) {
      if (!gesture.moved) {
        setOpenIds((current) => (current.includes(gesture.id) ? current : [...current, gesture.id]));
      }
      return;
    }
    if (sameBox(gesture.startBox, gesture.box)) {
      return;
    }
    const box = gesture.box;
    void updateTranslationPopup(gesture.id, box)
      .then((saved) => {
        setBlocks((current) => current.map((item) => (item.id === saved.id ? saved : item)));
        setDrafts((current) => {
          const next = { ...current };
          delete next[saved.id];
          return next;
        });
        onSaved();
      })
      .catch((saveError: unknown) => setError(errorText(saveError)));
  }

  function addToDictionary(block: TranslationBlockRecord) {
    if (savingIds.includes(block.id) || savedIds.includes(block.id)) {
      return;
    }
    setSavingIds((current) => [...current, block.id]);
    setError("");
    void createDictionaryEntry("global", null, block.ocrText, block.translatedText, "")
      .then(() => {
        setSavedIds((current) => (current.includes(block.id) ? current : [...current, block.id]));
        onAddedToDictionary();
      })
      .catch((saveError: unknown) => setError(errorText(saveError)))
      .finally(() => setSavingIds((current) => current.filter((id) => id !== block.id)));
  }

  function boxFor(block: TranslationBlockRecord, element?: HTMLElement): PageArea {
    if (drafts[block.id]) {
      return drafts[block.id];
    }
    if (hasCustomSize(block)) {
      return storedOrDefault(block);
    }
    if (element) {
      const measured = measureBox(element, layerRef.current);
      if (measured) {
        return measured;
      }
    }
    return storedOrDefault(block);
  }

  const visible = blocks.filter((block) => soloId === null || block.id === soloId);

  return (
    <div className="translation-overlay" ref={layerRef} data-overlay="on">
      {error ? <p className="error popup-error">{error}</p> : null}
      {visible.map((block) => {
        const open = openIds.includes(block.id);
        const fitted = open && !drafts[block.id] && !hasCustomSize(block);
        const box = boxFor(block);
        const anchor = collapsedAnchor(block, layerRef.current);
        return (
          <article
            key={block.id}
            className={
              [
                "translation-popup",
                open ? "" : "collapsed",
                highlightedId === block.id ? "selected" : "",
                fitted ? "fit" : "",
              ]
                .filter(Boolean)
                .join(" ")
            }
            data-popup-id={block.id}
            data-popup-open={open ? "1" : "0"}
            data-popup-x={open ? box.x : anchor.x}
            data-popup-y={open ? box.y : anchor.y}
            data-popup-width={fitted || !open ? undefined : box.width}
            data-popup-height={fitted || !open ? undefined : box.height}
            data-popup-fit={fitted ? "1" : undefined}
            style={{
              left: open ? `${box.x * 100}%` : `${anchor.x * 100}%`,
              top: open ? `${box.y * 100}%` : `${anchor.y * 100}%`,
              width: !open || fitted ? undefined : `${box.width * 100}%`,
              height: !open || fitted ? undefined : `${box.height * 100}%`,
            }}
            onPointerDown={(event) => onPointerDown(event, block)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          >
            {open ? (
              <>
                <header data-popup-drag>
                  <strong>{`#${block.id}`}</strong>
                  <span className="popup-actions">
                    <button
                      type="button"
                      className="icon-button"
                      data-popup-collapse
                      aria-label="Свернуть"
                      title="Свернуть"
                      onClick={() => {
                        setOpenIds((current) => current.filter((id) => id !== block.id));
                        onCollapse(block.id);
                      }}
                    >
                      <Icon name="clear" />
                    </button>
                  </span>
                </header>
                <p>{block.translatedText}</p>
                <button
                  type="button"
                  className="popup-dictionary"
                  data-popup-dictionary
                  disabled={
                    savingIds.includes(block.id) ||
                    savedIds.includes(block.id) ||
                    !block.ocrText.trim() ||
                    !block.translatedText.trim()
                  }
                  onClick={() => addToDictionary(block)}
                >
                  {savedIds.includes(block.id)
                    ? "В словаре"
                    : savingIds.includes(block.id)
                      ? "Добавление…"
                      : "Добавить в словарь"}
                </button>
                {RESIZE_EDGES.map((edge) => (
                  <span key={edge} data-popup-resize={edge} aria-hidden="true" />
                ))}
              </>
            ) : (
              <button
                type="button"
                className="translation-popup-icon"
                data-popup-icon
                data-popup-drag
                aria-label="Развернуть перевод"
                title="Развернуть перевод"
              >
                <Icon name="translate" />
                <span className="sr-only">Развернуть перевод</span>
              </button>
            )}
          </article>
        );
      })}
    </div>
  );
}

function collapsedAnchor(
  block: TranslationBlockRecord,
  layer: HTMLElement | null,
): { x: number; y: number } {
  const cx = block.sourceX + block.sourceWidth / 2;
  const cy = block.sourceY + block.sourceHeight / 2;
  const rect = layer?.getBoundingClientRect();
  if (!rect || rect.width <= 0 || rect.height <= 0) {
    return { x: round4(cx), y: round4(cy) };
  }
  const halfX = 16 / rect.width;
  const halfY = 16 / rect.height;
  return {
    x: round4(Math.min(Math.max(cx, halfX), 1 - halfX)),
    y: round4(Math.min(Math.max(cy, halfY), 1 - halfY)),
  };
}

function hasCustomSize(block: TranslationBlockRecord): boolean {
  if (
    block.popupX === null ||
    block.popupY === null ||
    block.popupWidth === null ||
    block.popupHeight === null
  ) {
    return false;
  }
  return (
    Math.abs(block.popupWidth - DEFAULT_WIDTH) > 0.001 ||
    Math.abs(block.popupHeight - DEFAULT_HEIGHT) > 0.001
  );
}

function measureBox(element: HTMLElement, layer: HTMLElement | null): PageArea | null {
  const bounds = layer?.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  if (!bounds || bounds.width <= 0 || bounds.height <= 0 || rect.width <= 0 || rect.height <= 0) {
    return null;
  }
  const width = Math.min(1, rect.width / bounds.width);
  const height = Math.min(1, rect.height / bounds.height);
  return {
    x: round4(Math.min(Math.max((rect.left - bounds.left) / bounds.width, 0), 1 - width)),
    y: round4(Math.min(Math.max((rect.top - bounds.top) / bounds.height, 0), 1 - height)),
    width: round4(width),
    height: round4(height),
  };
}

function storedOrDefault(block: TranslationBlockRecord): PageArea {
  if (
    block.popupX !== null &&
    block.popupY !== null &&
    block.popupWidth !== null &&
    block.popupHeight !== null
  ) {
    return {
      x: block.popupX,
      y: block.popupY,
      width: block.popupWidth,
      height: block.popupHeight,
    };
  }
  let x = block.sourceX + block.sourceWidth + 0.02;
  let y = block.sourceY;
  if (x + DEFAULT_WIDTH > 1) {
    x = block.sourceX;
    y = block.sourceY + block.sourceHeight + 0.02;
  }
  if (y + DEFAULT_HEIGHT > 1) {
    y = Math.max(0, 1 - DEFAULT_HEIGHT);
  }
  const width = Math.min(DEFAULT_WIDTH, 1);
  const height = Math.min(DEFAULT_HEIGHT, 1);
  return {
    x: round4(Math.min(Math.max(x, 0), 1 - width)),
    y: round4(Math.min(Math.max(y, 0), 1 - height)),
    width,
    height,
  };
}

function keepFittedPopupsInside(layer: HTMLElement) {
  const pad = 8;
  const bounds = layer.getBoundingClientRect();
  if (bounds.width <= 0) {
    return;
  }
  for (const popup of layer.querySelectorAll<HTMLElement>(".translation-popup.fit")) {
    const origin = Number(popup.dataset.popupX);
    if (!Number.isFinite(origin)) {
      continue;
    }
    popup.style.left = `${origin * 100}%`;
    const rect = popup.getBoundingClientRect();
    const overflowRight = rect.right - (bounds.right - pad);
    if (overflowRight > 0.5) {
      const left = rect.left - bounds.left - overflowRight;
      popup.style.left = `${Math.max(pad, left)}px`;
    }
  }
}

function resizeEdge(target: HTMLElement): ResizeEdge | null {
  const handle = target.closest("[data-popup-resize]");
  if (!(handle instanceof HTMLElement)) {
    return null;
  }
  const value = handle.dataset.popupResize;
  if (value && RESIZE_EDGES.includes(value as ResizeEdge)) {
    return value as ResizeEdge;
  }
  return "se";
}

function resizeFromEdge(
  start: PageArea,
  dx: number,
  dy: number,
  edge: ResizeEdge,
  minWidth: number,
  minHeight: number,
): PageArea {
  const west = edge.includes("w");
  const east = edge.includes("e");
  const north = edge.includes("n");
  const south = edge.includes("s");
  let left = start.x + (west ? dx : 0);
  let right = start.x + start.width + (east ? dx : 0);
  let top = start.y + (north ? dy : 0);
  let bottom = start.y + start.height + (south ? dy : 0);

  left = clampUnit(left);
  right = clampUnit(right);
  top = clampUnit(top);
  bottom = clampUnit(bottom);

  if (right - left < minWidth) {
    if (west && !east) {
      left = right - minWidth;
    } else {
      right = left + minWidth;
    }
  }
  if (bottom - top < minHeight) {
    if (north && !south) {
      top = bottom - minHeight;
    } else {
      bottom = top + minHeight;
    }
  }
  if (left < 0) {
    right -= left;
    left = 0;
  }
  if (right > 1) {
    left -= right - 1;
    right = 1;
  }
  if (top < 0) {
    bottom -= top;
    top = 0;
  }
  if (bottom > 1) {
    top -= bottom - 1;
    bottom = 1;
  }
  if (right - left < minWidth) {
    left = Math.max(0, Math.min(left, 1 - minWidth));
    right = left + minWidth;
  }
  if (bottom - top < minHeight) {
    top = Math.max(0, Math.min(top, 1 - minHeight));
    bottom = top + minHeight;
  }

  return {
    x: round4(left),
    y: round4(top),
    width: round4(Math.max(0, right - left)),
    height: round4(Math.max(0, bottom - top)),
  };
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function sameBox(left: PageArea, right: PageArea): boolean {
  return (
    Math.abs(left.x - right.x) < 0.0001 &&
    Math.abs(left.y - right.y) < 0.0001 &&
    Math.abs(left.width - right.width) < 0.0001 &&
    Math.abs(left.height - right.height) < 0.0001
  );
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
