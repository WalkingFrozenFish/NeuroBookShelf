import { locale, t } from "./i18n";
import type { ModelStatus, TranslationSettings } from "./libraryApi";

export function languageName(code: string): string {
  const mapped = code === "pb" ? "pt-BR" : code === "zt" ? "zh-Hant" : code;
  try {
    // DisplayNames is supported by the desktop WebView, independently of the TS lib target.
    const DisplayNames = (Intl as unknown as { DisplayNames: new (locales: string[], options: { type: string }) => { of: (code: string) => string | undefined } }).DisplayNames;
    return new DisplayNames([locale()], { type: "language" }).of(mapped) ?? code;
  } catch { return code; }
}

export function TranslationOptions({ settings, catalog, disabled, onChange }: {
  settings: TranslationSettings;
  catalog: ModelStatus["catalog"];
  disabled: boolean;
  onChange: (next: TranslationSettings) => void;
}) {
  const languages = [...new Set(["en", "ru", settings.targetLanguage, ...catalog.flatMap(item => [item.source, item.target])])]
    .filter(Boolean).sort((a, b) => languageName(a).localeCompare(languageName(b), locale()));
  return <div className="translation-options">
    <label>{t("Исходный язык")}
      <select aria-label={t("Исходный язык")} value={settings.sourceLanguage} disabled={disabled}
        onChange={event => onChange({ ...settings, sourceLanguage: event.target.value })}>
        <option value="auto">{t("Автоматически — несколько языков")}</option>
        {languages.map(code => <option key={code} value={code}>{languageName(code)} ({code})</option>)}
      </select>
    </label>
    <label>{t("Переводить на")}
      <select aria-label={t("Переводить на")} value={settings.targetLanguage} disabled={disabled}
        onChange={event => onChange({ ...settings, targetLanguage: event.target.value })}>
        {languages.map(code => <option key={code} value={code}>{languageName(code)} ({code})</option>)}
      </select>
    </label>
  </div>;
}
