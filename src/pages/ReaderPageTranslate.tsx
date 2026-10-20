import { t } from "../i18n";
import { useEffect, useState } from "react";
import { Icon } from "../icons";
import { translationQueue } from "../translationQueue";
import { errorText, modelStatus, setTranslationSettings, type ModelStatus, type TranslationSettings } from "../libraryApi";
import { languageName, TranslationOptions } from "../TranslationOptions";

export function ReaderPageTranslate({ documentId, title, pageNumber, pageCount }: {
  documentId: number; title: string; pageNumber: number; pageCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [first, setFirst] = useState(pageNumber);
  const [last, setLast] = useState(pageNumber);
  const [status, setStatus] = useState<ModelStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const refresh = () => void modelStatus().then(value => { if (active) setStatus(value); })
      .catch(failure => { if (active) setError(errorText(failure)); });
    refresh();
    window.addEventListener("llr-translation-settings", refresh);
    return () => { active = false; window.removeEventListener("llr-translation-settings", refresh); };
  }, []);
  async function saveDirection(next: TranslationSettings) {
    setSaving(true); setError("");
    try { await setTranslationSettings(next); setStatus(await modelStatus()); }
    catch (failure) { setError(errorText(failure)); }
    finally { setSaving(false); }
  }
  useEffect(() => { setFirst(pageNumber); setLast(pageNumber); setOpen(false); }, [documentId, pageNumber]);
  const valid = Number.isInteger(first) && Number.isInteger(last) && first >= 1 && last >= first && last <= pageCount;
  return <div className="page-translate-controls">
    <button type="button" className="icon-only" disabled={saving} title={t("Перевести страницу в фоне") + (status?.settings ? ` · ${status.settings.sourceLanguage === "auto" ? t("Автоопределение") : languageName(status.settings.sourceLanguage)} → ${languageName(status.settings.targetLanguage)}` : "")} aria-label={t("Перевести страницу в фоне")} onClick={() => translationQueue.enqueue(documentId, title, pageNumber, pageNumber)}><Icon name="translate" /></button>
    <button type="button" className="icon-only" title={t("Перевести диапазон страниц")} aria-label={t("Перевести диапазон страниц")} aria-expanded={open} onClick={() => setOpen(!open)}><Icon name="down" /></button>
    {open && <form className="translate-range" onSubmit={(event) => { event.preventDefault(); if (valid) { translationQueue.enqueue(documentId, title, first, last); setOpen(false); } }}>
      <strong>{t("Направление для новых переводов")}</strong>
      {status && <TranslationOptions settings={status.settings ?? { sourceLanguage: "auto", targetLanguage: "ru" }} catalog={status.catalog ?? []} disabled={saving} onChange={next => void saveDirection(next)} />}
      {error && <p className="error" role="alert">{error}</p>}
      <strong>{t("Перевести страницы")}</strong>
      <label>{t("С")}<input type="number" min={1} max={pageCount} value={first} onChange={(event) => setFirst(Number(event.target.value))} /></label>
      <label>{t("По")}<input type="number" min={first} max={pageCount} value={last} onChange={(event) => setLast(Number(event.target.value))} /></label>
      <small>{t("Сохранённые области будут пропущены.")}</small>
      <button type="submit" disabled={!valid || saving}>{t("Добавить в очередь")}</button>
      <button type="button" onClick={() => setOpen(false)}>{t("Закрыть")}</button>
    </form>}
  </div>;
}
