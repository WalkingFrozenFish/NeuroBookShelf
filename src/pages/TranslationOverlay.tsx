import { PointerEvent, useEffect, useRef, useState } from "react";
import { Icon } from "../icons";
import {
  errorText,
  listTranslationBlocks,
  TranslationBlockRecord,
  updateTranslationPopup,
} from "../libraryApi";
import { PageArea } from "./SelectionLayer";

const DEFAULT_WIDTH = 0.28;
const DEFAULT_HEIGHT = 0.16;

type Gesture = {
  id: number;
  mode: "drag" | "resize";
  startPointer: { x: number; y: number };
  startBox: PageArea;
  box: PageArea;
};

export function TranslationOverlay({
  documentId,
  pageNumber,
  blocksVersion,
  highlightedId,
  hiddenIds,
  soloId,
  onSelect,
  onHide,
  onSaved,
}: {
  documentId: number;
  pageNumber: number;
  blocksVersion: number;
  highlightedId: number | null;
  hiddenIds: number[];
  soloId: number | null;
  onSelect: (block: TranslationBlockRecord) => void;
  onHide: (id: number) => void;
  onSaved: () => void;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const [blocks, setBlocks] = useState<TranslationBlockRecord[]>([]);
  const [drafts, setDrafts] = useState<Record<number, PageArea>>({});
  const [error, setError] = useState("");

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

  function clampBox(box: PageArea): PageArea {
    const rect = layerRef.current?.getBoundingClientRect();
    const minWidth = rect && rect.width > 0 ? Math.min(1, Math.max(0.08, 120 / rect.width)) : 0.08;
    const minHeight = rect && rect.height > 0 ? Math.min(1, Math.max(0.06, 64 / rect.height)) : 0.06;
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
    if (target.closest("[data-popup-hide]")) {
      return;
    }
    onSelect(block);
    const mode = target.closest("[data-popup-resize]")
      ? "resize"
      : target.closest("[data-popup-drag]")
        ? "drag"
        : null;
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
      startPointer: pointFrom(event),
      startBox,
      box: startBox,
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
    const next =
      gesture.mode === "drag"
        ? { ...gesture.startBox, x: gesture.startBox.x + dx, y: gesture.startBox.y + dy }
        : {
            ...gesture.startBox,
            width: gesture.startBox.width + dx,
            height: gesture.startBox.height + dy,
          };
    const box = clampBox(next);
    gesture.box = box;
    setDrafts((current) => ({ ...current, [gesture.id]: box }));
  }

  function onPointerUp() {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (!gesture || sameBox(gesture.startBox, gesture.box)) {
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

  const visible = blocks.filter((block) => {
    if (hiddenIds.includes(block.id)) {
      return false;
    }
    return soloId === null || block.id === soloId;
  });

  return (
    <div className="translation-overlay" ref={layerRef} data-overlay="on">
      {error ? <p className="error popup-error">{error}</p> : null}
      {visible.map((block) => {
        const fitted = !drafts[block.id] && !hasCustomSize(block);
        const box = boxFor(block);
        return (
          <article
            key={block.id}
            className={
              highlightedId === block.id
                ? `translation-popup selected${fitted ? " fit" : ""}`
                : `translation-popup${fitted ? " fit" : ""}`
            }
            data-popup-id={block.id}
            data-popup-x={box.x}
            data-popup-y={box.y}
            data-popup-width={fitted ? undefined : box.width}
            data-popup-height={fitted ? undefined : box.height}
            data-popup-fit={fitted ? "1" : undefined}
            style={{
              left: `${box.x * 100}%`,
              top: `${box.y * 100}%`,
              width: fitted ? undefined : `${box.width * 100}%`,
              height: fitted ? undefined : `${box.height * 100}%`,
            }}
            onPointerDown={(event) => onPointerDown(event, block)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          >
            <header data-popup-drag>
              <strong>{`#${block.id}`}</strong>
              <button
                type="button"
                className="icon-button"
                data-popup-hide
                aria-label="Скрыть"
                onClick={() => onHide(block.id)}
              >
                <Icon name="clear" />
              </button>
            </header>
            <p>{block.translatedText}</p>
            <span data-popup-resize aria-hidden="true" />
          </article>
        );
      })}
    </div>
  );
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
