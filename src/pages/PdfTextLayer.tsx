import { useEffect, useRef, useState } from "react";
import { TextLayer, type PDFDocumentProxy } from "pdfjs-dist";
import type { PageViewport } from "pdfjs-dist/types/src/display/display_utils";
import { findTextMatches, joinPdfText, type TextMatch } from "../pdfText";
import { errorText } from "../libraryApi";
import { scrollWithinPanel } from "../scrollWithinPanel";

export function PdfTextLayer({ pdf, pageNumber, viewport, query, activeMatch, onError }: {
  pdf: PDFDocumentProxy; pageNumber: number; viewport: PageViewport;
  query: string; activeMatch: TextMatch | null; onError: (error: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const layer = useRef<TextLayer | null>(null);
  const [ready, setReady] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let rendered: TextLayer | null = null;
    const host = container.current!;
    host.replaceChildren(); layer.current = null;
    async function render() {
      const content = await (await pdf.getPage(pageNumber)).getTextContent();
      if (cancelled) return;
      rendered = new TextLayer({ textContentSource: content, container: host, viewport });
      await rendered.render();
      if (cancelled) return;
      layer.current = rendered;
      setReady((value) => value + 1);
    }
    void render().catch((failure) => { if (!cancelled) onError(`Не удалось загрузить текст страницы: ${errorText(failure)}`); });
    return () => { cancelled = true; rendered?.cancel(); layer.current = null; };
  }, [pdf, pageNumber, viewport, onError]);

  useEffect(() => {
    const current = layer.current;
    if (!current) return;
    const strings = current.textContentItemsStr;
    const { text, offsets } = joinPdfText(strings);
    const matches = findTextMatches(text, query, pageNumber);
    current.textDivs.forEach((span, i) => {
      const str = strings[i];
      const start = offsets[i];
      const end = start + str.length;
      span.replaceChildren();
      let cursor = 0;
      for (const match of matches) {
        if (match.end <= start || match.start >= end) continue;
        const left = Math.max(0, match.start - start);
        const right = Math.min(str.length, match.end - start);
        span.append(document.createTextNode(str.slice(cursor, left)));
        const mark = document.createElement("mark");
        mark.className = activeMatch?.pageNumber === pageNumber && activeMatch.start === match.start ? "pdf-match current" : "pdf-match";
        mark.textContent = str.slice(left, right);
        span.append(mark);
        cursor = right;
      }
      span.append(document.createTextNode(str.slice(cursor)));
    });
    const active = container.current?.querySelector<HTMLElement>(".pdf-match.current");
    const panel = container.current?.closest<HTMLElement>(".page-view");
    if (active && panel) scrollWithinPanel(active, panel);
  }, [ready, query, activeMatch, pageNumber]);
  return <div className="pdf-text-layer" ref={container} style={{ "--total-scale-factor": viewport.scale, "--scale-round-x": "1px", "--scale-round-y": "1px" } as React.CSSProperties} />;
}
