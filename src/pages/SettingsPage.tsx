import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { t } from "../i18n";
import { Icon } from "../icons";
import { ModelSetup } from "../ModelSetup";
import { accents, modes, pdfAppearances, type Appearance } from "../theme";

const tabs = [
  { id: "general", label: "Общие", icon: "settings" },
  { id: "data", label: "Данные", icon: "path" },
  { id: "models", label: "OCR и перевод", icon: "translate" },
  { id: "appearance", label: "Оформление", icon: "overlay" },
] as const;
type SettingsTab = (typeof tabs)[number]["id"];

type SettingsProps = {
  appearance: Appearance;
  onAppearance: (appearance: Appearance) => Promise<void>;
  appearancePending: boolean;
  pending: boolean;
  databasePath: string;
  onOpenDatabaseFolder: () => Promise<boolean>;
  onRelocate: () => Promise<boolean>;
  onSeed: () => Promise<boolean>;
  onRequestReset: (kind: "shelves" | "tags" | "library") => void;
};

export function SettingsPage({ appearance, onAppearance, appearancePending, pending, databasePath,
  onOpenDatabaseFolder, onRelocate, onSeed, onRequestReset }: SettingsProps) {
  const [active, setActive] = useState<SettingsTab>("general");
  const [modelsVisited, setModelsVisited] = useState(false);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const panels = useRef<(HTMLElement | null)[]>([]);

  function chooseTab(id: SettingsTab) {
    setActive(id);
    if (id === "models") setModelsVisited(true);
    const panel = panels.current[tabs.findIndex(tab => tab.id === id)];
    if (panel) panel.scrollTop = 0;
  }
  function navigateTabs(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    chooseTab(tabs[next].id);
    buttons.current[next]?.focus();
  }

  return <section className="settings-screen" aria-labelledby="settings-title">
    <header className="settings-heading">
      <h1 id="settings-title">{t("Настройки")}</h1>
      <p>{t("Язык, данные, локальные модели и оформление приложения.")}</p>
    </header>
    <div className="settings-tabs" role="tablist" aria-label={t("Разделы настроек")}>
      {tabs.map((tab, index) => <button key={tab.id} type="button" role="tab"
        id={`settings-tab-${tab.id}`} aria-controls={`settings-panel-${tab.id}`}
        aria-selected={active === tab.id} tabIndex={active === tab.id ? 0 : -1}
        ref={node => { buttons.current[index] = node; }}
        onClick={() => chooseTab(tab.id)} onKeyDown={event => navigateTabs(event, index)}>
        <Icon name={tab.icon} /><span>{t(tab.label)}</span>
      </button>)}
    </div>

    <section role="tabpanel" id="settings-panel-general" aria-labelledby="settings-tab-general"
      className="settings-panel" hidden={active !== "general"} tabIndex={0}
      ref={node => { panels.current[0] = node; }}>
      <section className="settings-block">
        <h2>{t("Язык приложения")}</h2>
        <p className="meta">{t("Язык интерфейса не меняет выбранное направление перевода книг.")}</p>
        <label className="settings-field">{t("Язык интерфейса")}
          <select aria-label={t("Язык интерфейса")} value={appearance.language ?? "ru"} disabled={appearancePending}
            onChange={event => void onAppearance({ ...appearance, language: event.target.value as "ru" | "en" })}>
            <option value="ru">Русский</option><option value="en">English</option>
          </select>
        </label>
      </section>
      <section className="settings-block settings-local-info">
        <h2>{t("Работа на вашем компьютере")}</h2>
        <p>{t("Книги, заметки и переводы хранятся локально. Для чтения PDF не нужны аккаунт и интернет.")}</p>
        <p className="meta">{t("Модели OCR и перевода загружаются отдельно во вкладке «OCR и перевод». После установки они работают без сети.")}</p>
      </section>
    </section>

    <section role="tabpanel" id="settings-panel-data" aria-labelledby="settings-tab-data"
      className="settings-panel" hidden={active !== "data"} tabIndex={0}
      ref={node => { panels.current[1] = node; }}>
      <section className="settings-block">
        <h2>{t("Хранение библиотеки")}</h2>
        <p className="meta">{t("Файл базы с каталогом книг, заметками и переводами")}</p>
        <code className="settings-path" title={databasePath}>{databasePath}</code>
        <div className="actions">
          <button type="button" disabled={pending} onClick={() => void onOpenDatabaseFolder()}><Icon name="path" />{t("Открыть папку")}</button>
          <button type="button" disabled={pending} onClick={() => void onRelocate()}>{t("Перенести базу…")}</button>
        </div>
        <p className="meta">{t("База копируется в выбранное место, и приложение использует новую копию. Прежняя копия остаётся. PDF-файлы не перемещаются.")}</p>
      </section>
      <section className="settings-block">
        <h2>{t("Примеры")}</h2>
        <p className="meta">{t("Книги с короткими PDF, полки, теги, слова словаря и две книги в корзине. Повторное нажатие добавит только то, чего ещё нет.")}</p>
        <button type="button" disabled={pending} onClick={() => void onSeed()}><Icon name="plus" />{t("Добавить примеры")}</button>
      </section>
      <section className="settings-block settings-danger">
        <h2>{t("Сброс данных")}</h2>
        <p className="meta">{t("Эти действия потребуют подтверждения. Перед очисткой сохраните резервную копию библиотеки.")}</p>
        <div className="settings-danger-row"><div><h3>{t("Сброс полок")}</h3><p>{t("Будут удалены все полки. Книги и теги останутся.")}</p></div>
          <button type="button" disabled={pending} onClick={() => onRequestReset("shelves")}>{t("Сбросить полки")}</button></div>
        <div className="settings-danger-row"><div><h3>{t("Сброс тегов")}</h3><p>{t("Будут удалены все теги. Книги и полки останутся.")}</p></div>
          <button type="button" disabled={pending} onClick={() => onRequestReset("tags")}>{t("Сбросить теги")}</button></div>
        <div className="settings-danger-row"><div><h3>{t("Очистить библиотеку")}</h3><p>{t("Книги исчезнут из библиотеки навсегда, восстановить их будет нельзя. Файлы на компьютере не удаляются.")}</p></div>
          <button type="button" className="danger" disabled={pending} onClick={() => onRequestReset("library")}>{t("Очистить библиотеку")}</button></div>
      </section>
    </section>

    <section role="tabpanel" id="settings-panel-models" aria-labelledby="settings-tab-models"
      className="settings-panel" hidden={active !== "models"} tabIndex={0}
      ref={node => { panels.current[2] = node; }}>
      {modelsVisited && <ModelSetup />}
    </section>

    <section role="tabpanel" id="settings-panel-appearance" aria-labelledby="settings-tab-appearance"
      className="settings-panel" hidden={active !== "appearance"} tabIndex={0}
      ref={node => { panels.current[3] = node; }}>
      <section className="settings-block">
        <h2>{t("Режим интерфейса")}</h2>
        <p className="meta">{t("Выберите светлый или тёмный режим. Цветовую гамму можно настроить отдельно.")}</p>
        <div className="theme-choices" role="group" aria-label={t("Режим интерфейса")}>
          {modes.map(item => <button key={item.id} type="button"
            className={appearance.mode === item.id ? "theme-choice active" : "theme-choice"}
            aria-pressed={appearance.mode === item.id} disabled={appearancePending}
            onClick={() => void onAppearance({ ...appearance, mode: item.id })}>
            <span className={`theme-swatch mode-${item.id}`} />{t(item.label)}</button>)}
        </div>
      </section>
      <section className="settings-block">
        <h2>{t("Цветовая гамма")}</h2>
        <div className="theme-choices" role="group" aria-label={t("Цветовая гамма")}>
          {accents.map(item => <button key={item.id} type="button"
            className={appearance.accent === item.id ? "theme-choice active" : "theme-choice"}
            aria-pressed={appearance.accent === item.id} disabled={appearancePending}
            onClick={() => void onAppearance({ ...appearance, accent: item.id })}>
            <span className="theme-swatch accent-swatch" style={{ "--swatch-hue": item.hue } as React.CSSProperties} />{t(item.label)}</button>)}
        </div>
        <CustomAccent appearance={appearance} pending={appearancePending} onChange={onAppearance} />
        <p className="meta">{t("Из выбранного цвета берётся основной оттенок. Яркость подстраивается под светлый и тёмный режимы.")}</p>
      </section>
      <section className="settings-block">
        <h2>{t("Страницы PDF")}</h2>
        <div className="theme-choices" role="group" aria-label={t("Отображение PDF")}>
          {pdfAppearances.map(item => <button key={item.id} type="button"
            className={appearance.pdf === item.id ? "theme-choice active" : "theme-choice"}
            aria-pressed={appearance.pdf === item.id} disabled={appearancePending}
            onClick={() => void onAppearance({ ...appearance, pdf: item.id })}>{t(item.label)}</button>)}
        </div>
        <p className="meta">{t("Приглушённый режим снижает яркость. Ночной затемняет белый фон, в том числе в сканах, но меняет цвета иллюстраций. Режим можно переключить в читалке. Исходный PDF не изменяется.")}</p>
      </section>
    </section>
  </section>;
}

function CustomAccent({ appearance, pending, onChange }: {
  appearance: Appearance; pending: boolean; onChange: (value: Appearance) => Promise<void>;
}) {
  const [color, setColor] = useState(appearance.customColor ?? "#3875c7");
  useEffect(() => { setColor(appearance.customColor ?? "#3875c7"); }, [appearance.customColor]);
  return <div className="custom-color-control">
    <label>{t("Свой цвет")} <input type="color" aria-label={t("Свой цвет")} value={color} onChange={event => setColor(event.target.value)} /></label>
    <code>{color}</code>
    <button type="button" disabled={pending || (appearance.accent === "custom" && color === appearance.customColor)}
      onClick={() => void onChange({ ...appearance, accent: "custom", customColor: color })}>{t("Применить цвет")}</button>
  </div>;
}
