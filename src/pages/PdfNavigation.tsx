import { t } from "../i18n";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { errorText } from "../libraryApi";
import { findTextMatches, joinPdfText, type TextMatch } from "../pdfText";

type OutlineItem = NonNullable<Awaited<ReturnType<PDFDocumentProxy["getOutline"]>>>[number];

export function PdfNavigation({ pdf, pageNumber, onOpenPage, onMatch, onQueryChange, onOpenPanel, children }: {
  pdf: PDFDocumentProxy; pageNumber: number; onOpenPage: (page: number) => Promise<boolean>;
  onMatch: (match: TextMatch | null) => void; onQueryChange: (query: string) => void;
  onOpenPanel: () => void; children: ReactNode;
}) {
  const [tab, setTab] = useState("pages");
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<TextMatch[]>([]);
  const [selected, setSelected] = useState(-1);
  const [scanned, setScanned] = useState(0);
  const [searching, setSearching] = useState(false);
  const [limit, setLimit] = useState(100);
  const [outline, setOutline] = useState<OutlineItem[] | null>(null);
  const [outlineLoading, setOutlineLoading] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const cache = useRef(new Map<number, string>());
  const searchToken = useRef(0);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault(); setTab("search"); onOpenPanel();
        window.setTimeout(() => { input.current?.focus(); input.current?.select(); }, 0);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onOpenPanel]);

  useEffect(() => {
    if (tab === "search") input.current?.focus();
  }, [tab]);

  useEffect(() => {
    if (tab !== "outline" || outline !== null) return;
    let active = true;
    setOutlineLoading(true); setError("");
    pdf.getOutline().then((items) => { if (active) setOutline(items ?? []); })
      .catch((failure) => { if (active) setError(errorText(failure)); })
      .finally(() => { if (active) setOutlineLoading(false); });
    return () => { active = false; };
  }, [pdf, tab, outline]);

  useEffect(() => {
    const token = ++searchToken.current;
    onQueryChange(query);
    setMatches([]); setSelected(-1); setScanned(0); setLimit(100); onMatch(null); setError("");
    if (!query.trim()) { setSearching(false); return; }
    setSearching(true);
    const timer = window.setTimeout(async () => {
      const found: TextMatch[] = [];
      try {
        for (let page = 1; page <= pdf.numPages; page++) {
          if (searchToken.current !== token) return;
          let text = cache.current.get(page);
          if (text === undefined) {
            const content = await (await pdf.getPage(page)).getTextContent();
            if (searchToken.current !== token) return;
            text = joinPdfText(content.items.filter((item) => "str" in item).map((item) => item.str)).text;
            cache.current.set(page, text);
          }
          found.push(...findTextMatches(text, query, page));
          setMatches([...found]); setScanned(page);
          // Yield even when all pages are cached so typing and cancel stay responsive.
          await new Promise((resolve) => window.setTimeout(resolve, 0));
        }
      } catch (failure) {
        if (searchToken.current === token) setError(errorText(failure));
      } finally {
        if (searchToken.current === token) setSearching(false);
      }
    }, 220);
    return () => { window.clearTimeout(timer); searchToken.current++; };
  }, [pdf, query, onMatch, onQueryChange]);

  async function choose(index: number) {
    if (!matches.length) return;
    const next = (index + matches.length) % matches.length;
    const hit = matches[next];
    if (hit.pageNumber === pageNumber || await onOpenPage(hit.pageNumber)) {
      setSelected(next); onMatch(hit);
    }
  }
  async function openDestination(item: OutlineItem) {
    try {
      setError("");
      const dest = typeof item.dest === "string" ? await pdf.getDestination(item.dest) : item.dest;
      if (!dest?.length) throw new Error(t("В оглавлении нет адреса страницы"));
      const index = typeof dest[0] === "number" ? dest[0] : await pdf.getPageIndex(dest[0]);
      if (index < 0 || index >= pdf.numPages) throw new Error(t("Страница оглавления недоступна"));
      await onOpenPage(index + 1);
    } catch (failure) { setError(errorText(failure)); }
  }
  function outlineList(items: OutlineItem[]): ReactNode {
    return <ol className="pdf-outline">{items.map((item, i) => <li key={i}>
      <button type="button" disabled={!item.dest} title={item.title} onClick={() => void openDestination(item)}>{item.title || t("Без названия")}</button>
      {item.items?.length > 0 && <details><summary>{t("Подразделы (")}{" "}{item.items.length})</summary>{outlineList(item.items)}</details>}
    </li>)}</ol>;
  }
  return <div className="pdf-navigation">
    <div className="pdf-nav-tabs" aria-label={t("Навигация PDF")}>
      {[["pages", t("Страницы")], ["outline", t("Оглавление")], ["search", t("Поиск")]].map(([id, label]) => <button type="button" key={id} className={tab === id ? "active" : ""} aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>)}
    </div>
    {tab === "pages" && <div className="thumbs-scroll">{children}</div>}
    {tab === "outline" && <div className="pdf-nav-body">{outlineLoading ? <p role="status">{t("Загрузка оглавления…")}</p> : outline?.length ? outlineList(outline) : <p>{t("В этом PDF нет встроенного оглавления.")}</p>}{error && <p className="error">{error}</p>}</div>}
    {tab === "search" && <div className="pdf-nav-body">
      <form onSubmit={(event) => { event.preventDefault(); void choose(selected + 1); }}>
        <label>{t("Найти в книге")}<input ref={input} type="search" value={query} placeholder={t("Слово или фраза…")} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
          if (event.key === "Escape") { event.preventDefault(); setQuery(""); }
          if (event.key === "Enter" && event.shiftKey) { event.preventDefault(); void choose(selected - 1); }
        }} /></label>
        <div className="pdf-search-controls">
          <button type="button" disabled={!matches.length} aria-label={t("Предыдущее совпадение")} onClick={() => void choose(selected < 0 ? matches.length - 1 : selected - 1)}>↑</button>
          <span>{selected >= 0 ? `${selected + 1} / ` : ""}{matches.length}</span>
          <button type="submit" disabled={!matches.length} aria-label={t("Следующее совпадение")}>↓</button>
        </div>
      </form>
      {searching && <p role="status">{t("Поиск:")}{" "}{scanned} / {pdf.numPages} <button type="button" onClick={() => { searchToken.current++; setSearching(false); }}>{t("Остановить")}</button></p>}
      {error && <p className="error">{error}</p>}
      {!searching && query.trim() && !matches.length && <p>{t("Совпадений нет.")}</p>}
      <p className="meta">{t("Поиск по текстовому слою. Сканы без текста не индексируются. Enter / Shift+Enter — переход.")}</p>
      <ol className="pdf-search-results">{matches.slice(0, limit).map((hit, index) => <li key={`${hit.pageNumber}-${hit.start}`}><button type="button" className={selected === index ? "active" : ""} onClick={() => void choose(index)}><strong>{t("Стр.")}{" "}{hit.pageNumber}</strong><span>{hit.preview}</span></button></li>)}</ol>
      {matches.length > limit && <button type="button" onClick={() => setLimit(limit + 100)}>{t("Показать ещё")}</button>}
    </div>}
  </div>;
}
