import { useEffect, useState } from "react";
import { Icon } from "../icons";
import { translationQueue } from "../translationQueue";

export function ReaderPageTranslate({ documentId, title, pageNumber, pageCount }: {
  documentId: number; title: string; pageNumber: number; pageCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [first, setFirst] = useState(pageNumber);
  const [last, setLast] = useState(pageNumber);
  useEffect(() => { setFirst(pageNumber); setLast(pageNumber); setOpen(false); }, [documentId, pageNumber]);
  const valid = Number.isInteger(first) && Number.isInteger(last) && first >= 1 && last >= first && last <= pageCount;
  return <div className="page-translate-controls">
    <button type="button" className="icon-only" title="Перевести страницу в фоне" aria-label="Перевести страницу в фоне" onClick={() => translationQueue.enqueue(documentId, title, pageNumber, pageNumber)}><Icon name="translate" /></button>
    <button type="button" className="icon-only" title="Перевести диапазон страниц" aria-label="Перевести диапазон страниц" aria-expanded={open} onClick={() => setOpen(!open)}><Icon name="down" /></button>
    {open && <form className="translate-range" onSubmit={(event) => { event.preventDefault(); if (valid) { translationQueue.enqueue(documentId, title, first, last); setOpen(false); } }}>
      <strong>Перевести страницы</strong>
      <label>С <input type="number" min={1} max={pageCount} value={first} onChange={(event) => setFirst(Number(event.target.value))} /></label>
      <label>По <input type="number" min={first} max={pageCount} value={last} onChange={(event) => setLast(Number(event.target.value))} /></label>
      <small>Сохранённые области будут пропущены.</small>
      <button type="submit" disabled={!valid}>Добавить в очередь</button>
      <button type="button" onClick={() => setOpen(false)}>Закрыть</button>
    </form>}
  </div>;
}
