import { PointerEvent, useEffect, useRef, useState } from "react";
import { Icon } from "../icons";

export type PageArea = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const MIN_PIXELS = 4;

type Point = {
  x: number;
  y: number;
};

export function SelectionLayer({
  active,
  selection,
  onSelect,
  translateLabel,
  translateError,
  translateDisabled,
  onTranslate,
}: {
  active: boolean;
  selection: PageArea | null;
  onSelect: (area: PageArea) => void;
  translateLabel: string;
  translateError: string;
  translateDisabled: boolean;
  onTranslate: () => void;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Point | null>(null);
  const [draft, setDraft] = useState<PageArea | null>(null);

  useEffect(() => {
    if (!active) {
      dragRef.current = null;
      setDraft(null);
    }
  }, [active]);

  function pointFrom(event: PointerEvent<HTMLDivElement>): Point {
    const rect = layerRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return { x: 0, y: 0 };
    }
    return {
      x: clamp01((event.clientX - rect.left) / rect.width),
      y: clamp01((event.clientY - rect.top) / rect.height),
    };
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!active || event.button !== 0) {
      return;
    }
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* An untrusted test event cannot capture the pointer. */
    }
    const start = pointFrom(event);
    dragRef.current = start;
    setDraft(areaFrom(start, start));
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const start = dragRef.current;
    if (!start) {
      return;
    }
    setDraft(areaFrom(start, pointFrom(event)));
  }

  function finish(event: PointerEvent<HTMLDivElement>, commit: boolean) {
    const start = dragRef.current;
    if (!start) {
      return;
    }
    dragRef.current = null;
    const area = areaFrom(start, pointFrom(event));
    const rect = layerRef.current?.getBoundingClientRect();
    const tooSmall =
      !rect || area.width * rect.width < MIN_PIXELS || area.height * rect.height < MIN_PIXELS;
    setDraft(null);
    if (commit && !tooSmall) {
      onSelect(area);
    }
  }

  const shown = draft ?? selection;

  return (
    <div
      ref={layerRef}
      className={active ? "selection-layer active" : "selection-layer"}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => finish(event, true)}
      onPointerCancel={(event) => finish(event, false)}
    >
      {shown && (shown.width > 0 || shown.height > 0) ? (
        <div
          className="selection-box"
          data-selection-box=""
          style={{
            left: `${shown.x * 100}%`,
            top: `${shown.y * 100}%`,
            width: `${shown.width * 100}%`,
            height: `${shown.height * 100}%`,
          }}
        >
          {!draft && selection ? (
            <div
              className={selection.y < 0.12 ? "selection-actions below" : "selection-actions"}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                className="primary"
                disabled={translateDisabled}
                onClick={onTranslate}
              >
                {translateDisabled ? <span className="notice-spinner" aria-hidden="true" /> : <Icon name="translate" />}
                {translateLabel}
              </button>
              {translateError ? <p className="error">{translateError}</p> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function areaFrom(start: Point, end: Point): PageArea {
  const x = round4(Math.min(start.x, end.x));
  const y = round4(Math.min(start.y, end.y));
  return {
    x,
    y,
    width: round4(Math.min(Math.abs(end.x - start.x), 1 - x)),
    height: round4(Math.min(Math.abs(end.y - start.y), 1 - y)),
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
