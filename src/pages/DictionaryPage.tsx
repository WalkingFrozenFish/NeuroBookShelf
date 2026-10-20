import { locale, t } from "../i18n";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../icons";
import {
  createDictionaryEntry,
  deleteDictionaryEntry,
  DictionaryEntryRecord,
  errorText,
  listDictionaryEntries,
  updateDictionaryEntry,
} from "../libraryApi";

type Script = "en" | "ru";

type DictionaryWord = {
  word: string;
  translations: string[];
};

type TranslationRow = {
  entryId: number | null;
  text: string;
};

type EditorState = {
  key: string | null;
  side: Script;
};

function dictionaryForm(text: string): string {
  return text.trim().toLocaleLowerCase();
}

const EN_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const RU_LETTERS = "АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ".split("");
const OTHER = "·";

function initial(text: string, script: Script): string | null {
  const char = Array.from(text.trim())[0];
  if (!char) {
    return null;
  }
  const upper = char.toLocaleUpperCase(script === "en" ? "en" : "ru");
  const alphabet = script === "en" ? EN_LETTERS : RU_LETTERS;
  return alphabet.includes(upper) ? upper : null;
}

function groupEntries(entries: DictionaryEntryRecord[]): DictionaryWord[] {
  const grouped = new Map<string, DictionaryWord>();
  for (const entry of entries) {
    const word = dictionaryForm(entry.sourceText);
    const translation = dictionaryForm(entry.translatedText);
    if (!word || !translation) {
      continue;
    }
    const key = word;
    let item = grouped.get(key);
    if (!item) {
      item = { word, translations: [] };
      grouped.set(key, item);
    }
    const known = item.translations.some((existing) => existing === translation);
    if (!known) {
      item.translations.push(translation);
    }
  }
  return [...grouped.values()].sort((left, right) =>
    left.word.localeCompare(right.word, "en", { sensitivity: "base" }),
  );
}

function groupByRussian(entries: DictionaryEntryRecord[]): DictionaryWord[] {
  const grouped = new Map<string, DictionaryWord>();
  for (const entry of entries) {
    const word = dictionaryForm(entry.translatedText);
    const translation = dictionaryForm(entry.sourceText);
    if (!word || !translation) {
      continue;
    }
    const key = word;
    let item = grouped.get(key);
    if (!item) {
      item = { word, translations: [] };
      grouped.set(key, item);
    }
    const known = item.translations.some((existing) => existing === translation);
    if (!known) {
      item.translations.push(translation);
    }
  }
  return [...grouped.values()].sort((left, right) =>
    left.word.localeCompare(right.word, "ru", { sensitivity: "base" }),
  );
}

function prefer(items: string[], match: (item: string) => boolean): string[] {
  const chosen = items.filter(match);
  if (chosen.length === 0 || chosen.length === items.length) {
    return items;
  }
  return [...chosen, ...items.filter((item) => !match(item))];
}

function startsWithWord(text: string, needle: string): boolean {
  return text
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .some((word) => word.startsWith(needle));
}

function arrangeTranslations(word: DictionaryWord, query: string): string[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) {
    return word.translations;
  }
  return prefer(word.translations, (item) => startsWithWord(item, needle));
}

function matchesQuery(word: DictionaryWord, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) {
    return true;
  }
  return startsWithWord(word.word, needle) || word.translations.some((item) => startsWithWord(item, needle));
}

function matchesLetter(word: DictionaryWord, letter: string, script: Script): boolean {
  return (initial(word.word, script) ?? OTHER) === letter;
}

function wordsLabel(count: number): string {
  if (locale() === "en-US") return t(count === 1 ? "{0} слово" : "{0} слов", [count]);
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) {
    return t("{0} слово", [count]);
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return t("{0} слова", [count]);
  }
  return t("{0} слов", [count]);
}

export function DictionaryPage({ onBack }: { onBack: () => void }) {
  const [entries, setEntries] = useState<DictionaryEntryRecord[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [script, setScript] = useState<Script>("en");
  const [letter, setLetter] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [removing, setRemoving] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const lettersRef = useRef<HTMLElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    listDictionaryEntries("global", null, "")
      .then((list) => {
        if (active) {
          setEntries(list);
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
  }, []);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!confirmDelete) {
      return;
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !removing) {
        setConfirmDelete(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmDelete, removing]);

  const words = useMemo(
    () => (entries ? (script === "en" ? groupEntries(entries) : groupByRussian(entries)) : []),
    [entries, script],
  );
  const needle = query.trim();
  const shown = useMemo(() => {
    if (needle) {
      return words.filter((word) => matchesQuery(word, needle));
    }
    if (!letter) {
      return [];
    }
    return words.filter((word) => matchesLetter(word, letter, script));
  }, [words, needle, letter, script]);

  useEffect(() => {
    if (resultsRef.current) {
      resultsRef.current.scrollTop = 0;
    }
  }, [letter, needle, script]);

  useEffect(() => {
    if (!letter) {
      return;
    }
    const node = lettersRef.current?.querySelector<HTMLButtonElement>(`[data-lexicon-letter="${letter}"]`);
    node?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [letter, script]);

  const hasOther = words.some((word) => initial(word.word, script) === null);
  const alphabet = script === "en" ? EN_LETTERS : RU_LETTERS;
  const letters = hasOther ? [...alphabet, OTHER] : alphabet;

  function chooseScript(next: Script) {
    setScript(next);
    setLetter(null);
    setSelected(new Set());
  }

  function toggleWord(key: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function toggleVisible() {
    const keys = shown.map((word) => dictionaryForm(word.word));
    setSelected((current) => {
      const next = new Set(current);
      const all = keys.length > 0 && keys.every((key) => next.has(key));
      for (const key of keys) {
        if (all) {
          next.delete(key);
        } else {
          next.add(key);
        }
      }
      return next;
    });
  }

  async function removeSelected() {
    if (!entries) {
      return;
    }
    const ids = entries
      .filter((entry) => selected.has(dictionaryForm(script === "en" ? entry.sourceText : entry.translatedText)))
      .map((entry) => entry.id);
    setRemoving(true);
    setError("");
    try {
      for (const id of ids) {
        await deleteDictionaryEntry(id);
      }
      setEntries(await listDictionaryEntries("global", null, ""));
      setSelected(new Set());
      setConfirmDelete(false);
    } catch (removeError: unknown) {
      setError(errorText(removeError));
      try {
        setEntries(await listDictionaryEntries("global", null, ""));
      } catch {
        // Список обновится при следующем открытии страницы.
      }
    } finally {
      setRemoving(false);
    }
  }

  function chooseLetter(next: string) {
    setQuery("");
    setLetter((current) => (current === next ? null : next));
  }

  const heading = needle ? t("Поиск") : letter === OTHER ? t("Остальные") : letter;

  return (
    <section className="lexicon">
      <button type="button" className="lexicon-back" onClick={onBack}>
        <Icon name="back" />
        {t("Библиотека")}</button>
      <header className="lexicon-head">
        <div className="lexicon-title">
          <h1>{t("Словарь")}</h1>
          <button type="button" className="primary" onClick={() => setEditor({ key: null, side: script })}>
            <Icon name="plus" />
            {t("Добавить")}</button>
        </div>
      </header>
      <div className="lexicon-tools">
        <label className="lexicon-search">
          <span className="sr-only">{t("Поиск по английскому и русскому")}</span>
          <input
            ref={searchRef}
            type="search"
            value={query}
            placeholder={t("Поиск по английскому или русскому")}
            spellCheck={false}
            onChange={(event) => {
              const next = event.target.value;
              setQuery(next);
              if (next.trim()) {
                setLetter(null);
              }
            }}
          />
        </label>
        <div className="lexicon-script" role="tablist" aria-label={t("Алфавит")}>
          <button
            type="button"
            role="tab"
            aria-selected={script === "en"}
            className={script === "en" ? "active" : undefined}
            onClick={() => chooseScript("en")}
          >
            English
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={script === "ru"}
            className={script === "ru" ? "active" : undefined}
            onClick={() => chooseScript("ru")}
          >
            {t("Русский")}</button>
        </div>
        <nav
          ref={lettersRef}
          className="lexicon-letters"
          aria-label={script === "en" ? t("Английские буквы") : t("Русские буквы")}
        >
          {letters.map((item) => {
            const count = words.filter((word) => matchesLetter(word, item, script)).length;
            const active = !needle && letter === item;
            return (
              <button
                key={item}
                type="button"
                data-lexicon-letter={item}
                aria-current={active ? "page" : undefined}
                aria-label={item === OTHER ? t("Остальные") : t("Буква {0}", [item])}
                disabled={count === 0}
                className={active ? "active" : undefined}
                onClick={() => chooseLetter(item)}
              >
                {item}
              </button>
            );
          })}
        </nav>
      </div>
      <div className="lexicon-results" ref={resultsRef} aria-live="polite">
        {error ? <p className="error">{error}</p> : null}
        {entries === null && !error ? <p>{t("Загрузка словаря…")}</p> : null}
        {entries && words.length === 0 ? (
          <div className="lexicon-placeholder">
            <p>{t("В словаре пока нет слов.")}</p>
            <p>{t("Добавьте слово кнопкой выше или сохраните его из перевода в книге.")}</p>
          </div>
        ) : null}
        {entries && words.length > 0 && !needle && !letter ? (
          <div className="lexicon-placeholder">
            <p>{t("Выберите букву, чтобы открыть слова на неё.")}</p>
          </div>
        ) : null}
        {entries && words.length > 0 && (needle || letter) && shown.length === 0 ? (
          <div className="lexicon-placeholder">
            <p>{t("Ничего не нашлось.")}</p>
          </div>
        ) : null}
        {shown.length > 0 && heading ? (
          <>
            <header className="lexicon-results-head">
              <h2 className={needle ? "lexicon-results-search" : undefined}>{heading}</h2>
              <p className="meta">{wordsLabel(shown.length)}</p>
            </header>
            <div className="lexicon-select-bar">
              <label className="lexicon-check">
                <WordSelect
                  checked={shown.every((word) => selected.has(dictionaryForm(word.word)))}
                  indeterminate={
                    shown.some((word) => selected.has(dictionaryForm(word.word))) &&
                    !shown.every((word) => selected.has(dictionaryForm(word.word)))
                  }
                  disabled={removing}
                  label={t("Выбрать все")}
                  onChange={toggleVisible}
                />
                <span>{t("Выбрать все")}</span>
              </label>
              {selected.size > 0 ? <span className="meta">{t("Выбрано:")}{" "}{selected.size}</span> : null}
              {selected.size > 0 ? (
                <button
                  type="button"
                  className="danger"
                  disabled={removing}
                  onClick={() => setConfirmDelete(true)}
                >
                  <Icon name="trash" />
                  {t("Удалить")}</button>
              ) : null}
            </div>
            <ol className="lexicon-list">
              {shown.map((word) => {
                const key = dictionaryForm(word.word);
                return (
                <li key={key} className={selected.has(key) ? "selected" : undefined}>
                  <div className="lexicon-word-line">
                    <label className="lexicon-check">
                      <input
                        type="checkbox"
                        checked={selected.has(key)}
                        disabled={removing}
                        aria-label={t("Выбрать {0}", [word.word])}
                        onChange={() => toggleWord(key)}
                      />
                    </label>
                    <p className="lexicon-word">{word.word}</p>
                    <button
                      type="button"
                      className="icon-button lexicon-edit"
                      aria-label={t("Изменить {0}", [word.word])}
                      onClick={() => setEditor({ key: word.word.toLocaleLowerCase(), side: script })}
                    >
                      <Icon name="edit" />
                    </button>
                  </div>
                  <ol className="lexicon-meanings">
                    {arrangeTranslations(word, needle).map((translation) => (
                      <li key={translation.toLocaleLowerCase()}>{translation}</li>
                    ))}
                  </ol>
                </li>
                );
              })}
            </ol>
          </>
        ) : null}
      </div>
      {editor ? (
        <WordModal
          entries={entries ?? []}
          editingKey={editor.key}
          side={editor.side}
          onClose={() => setEditor(null)}
          onRefresh={setEntries}
          onSaved={(list, word) => {
            const side = editor.side;
            setEntries(list);
            setError("");
            setEditor(null);
            setScript(side);
            setQuery("");
            setLetter(initial(word, side) ?? OTHER);
          }}
        />
      ) : null}
      {confirmDelete ? (
        <div
          className="modal-backdrop"
          onMouseDown={() => {
            if (!removing) {
              setConfirmDelete(false);
            }
          }}
        >
          <div
            className="modal lexicon-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="lexicon-delete-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2 id="lexicon-delete-title">{t("Удалить слова")}</h2>
            <p>
              {selected.size === 1
                ? t("Выбранное слово исчезнет из словаря.")
                : t("Выбранные слова ({0}) исчезнут из словаря.", [selected.size])}
            </p>
            <div className="lexicon-modal-actions">
              <button type="button" disabled={removing} onClick={() => setConfirmDelete(false)}>
                {t("Отмена")}</button>
              <button type="button" className="danger" disabled={removing} onClick={() => void removeSelected()}>
                {t("Удалить")}</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function WordSelect({
  checked,
  indeterminate,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  disabled: boolean;
  label: string;
  onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      aria-label={label}
      onChange={onChange}
    />
  );
}

function WordModal({
  entries,
  editingKey,
  side,
  onClose,
  onRefresh,
  onSaved,
}: {
  entries: DictionaryEntryRecord[];
  editingKey: string | null;
  side: Script;
  onClose: () => void;
  onRefresh: (entries: DictionaryEntryRecord[]) => void;
  onSaved: (entries: DictionaryEntryRecord[], word: string) => void;
}) {
  const owned = side === "en" ? entriesForWord(entries, editingKey) : entriesForTranslation(entries, editingKey);
  const [source, setSource] = useState(
    dictionaryForm(side === "en" ? owned[0]?.sourceText ?? "" : owned[0]?.translatedText ?? ""),
  );
  const [rows, setRows] = useState<TranslationRow[]>(rowsForSide(owned, side));
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const sourceRef = useRef<HTMLInputElement>(null);
  const originIds = useRef(owned.map((entry) => entry.id));
  const ready = source.trim() !== "" && rows.some((row) => row.text.trim() !== "");
  const known = knownMeanings(entries, side, source, originIds.current);

  useEffect(() => {
    sourceRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !pending) {
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, pending]);

  function updateRow(index: number, value: string) {
    setRows((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, text: value } : row)));
  }

  function removeRow(index: number) {
    setRows((current) => current.filter((_, rowIndex) => rowIndex !== index));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const word = dictionaryForm(source);
    const translations = uniqueRows(rows);
    if (!word || translations.length === 0) {
      return;
    }
    const origin = new Set(originIds.current);
    const englishSide = side === "en";
    const taken = new Set(
      entries
        .filter((entry) => !origin.has(entry.id) && pairKey(entry, englishSide) === word.toLocaleLowerCase())
        .map((entry) => otherText(entry, englishSide).toLocaleLowerCase()),
    );
    const updates: { id: number; text: string; note: string }[] = [];
    const creates: string[] = [];
    const kept = new Set<number>();
    for (const row of translations) {
      const key = row.text.toLocaleLowerCase();
      const entry =
        row.entryId === null ? undefined : entries.find((item) => item.id === row.entryId && origin.has(item.id));
      if (entry) {
        if (!taken.has(key)) {
          const head = englishSide ? entry.sourceText.trim() : entry.translatedText.trim();
          const gloss = englishSide ? entry.translatedText.trim() : entry.sourceText.trim();
          if (head !== word || gloss !== row.text) {
            updates.push({ id: entry.id, text: row.text, note: entry.note });
          }
          kept.add(entry.id);
          taken.add(key);
        }
        continue;
      }
      if (taken.has(key)) {
        continue;
      }
      creates.push(row.text);
      taken.add(key);
    }
    const deletions = originIds.current.filter((id) => !kept.has(id) && entries.some((entry) => entry.id === id));
    if (updates.length === 0 && creates.length === 0 && deletions.length === 0) {
      if (editingKey === null) {
        setError(t("Такие переводы уже есть у этого слова."));
        return;
      }
      onSaved(entries, word);
      return;
    }
    setPending(true);
    setError("");
    try {
      for (const update of updates) {
        const sourceText = englishSide ? word : update.text;
        const translatedText = englishSide ? update.text : word;
        await updateDictionaryEntry(update.id, sourceText, translatedText, update.note);
      }
      for (const translation of creates) {
        const sourceText = englishSide ? word : translation;
        const translatedText = englishSide ? translation : word;
        await createDictionaryEntry("global", null, sourceText, translatedText, "");
      }
      for (const id of deletions) {
        await deleteDictionaryEntry(id);
      }
      onSaved(await listDictionaryEntries("global", null, ""), word);
    } catch (saveError: unknown) {
      setError(errorText(saveError));
      try {
        onRefresh(await listDictionaryEntries("global", null, ""));
      } catch {
        // Список обновится при следующем открытии страницы.
      }
      setPending(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={() => {
        if (!pending) {
          onClose();
        }
      }}
    >
      <form
        className="modal lexicon-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lexicon-add-title"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => void submit(event)}
      >
        <h2 id="lexicon-add-title">{editingKey === null ? t("Новое слово") : t("Изменить слово")}</h2>
        <label>
          {side === "en" ? t("Английское слово") : t("Русское слово")}
          <input
            ref={sourceRef}
            value={source}
            autoComplete="off"
            spellCheck={false}
            disabled={pending}
            placeholder={side === "en" ? "hello" : "привет"}
            onChange={(event) => setSource(event.target.value)}
          />
        </label>
        <div className="lexicon-translations">
          <span className="lexicon-field-label">{side === "en" ? t("Русские переводы") : t("Английские слова")}</span>
          {rows.map((row, index) => (
            <div className="lexicon-translation-row" key={index}>
              <input
                value={row.text}
                autoComplete="off"
                spellCheck={false}
                disabled={pending}
                aria-label={t("Перевод {0}", [index + 1])}
                placeholder={index === 0 ? (side === "en" ? "привет" : "hello") : t("ещё вариант")}
                onChange={(event) => updateRow(index, event.target.value)}
              />
              {rows.length > 1 ? (
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t("Убрать перевод {0}", [index + 1])}
                  disabled={pending}
                  onClick={() => removeRow(index)}
                >
                  <Icon name="clear" />
                </button>
              ) : null}
            </div>
          ))}
          {rows.length < 8 ? (
            <button
              type="button"
              className="lexicon-more"
              disabled={pending}
              onClick={() => setRows((current) => [...current, { entryId: null, text: "" }])}
            >
              <Icon name="plus" />
              {t("Ещё перевод")}</button>
          ) : null}
        </div>
        {known.length > 0 ? <p className="meta">{t("Уже есть:")}{" "}{known.join(", ")}</p> : null}
        {error ? <p className="error">{error}</p> : null}
        <div className="lexicon-modal-actions">
          <button type="submit" className="primary" disabled={pending || !ready}>
            {editingKey === null ? t("Добавить") : t("Сохранить")}
          </button>
          <button type="button" disabled={pending} onClick={onClose}>
            {t("Отмена")}</button>
        </div>
      </form>
    </div>
  );
}

function entriesForWord(entries: DictionaryEntryRecord[], key: string | null): DictionaryEntryRecord[] {
  return entriesFor(entries, key, (entry) => entry.sourceText);
}

function entriesForTranslation(entries: DictionaryEntryRecord[], key: string | null): DictionaryEntryRecord[] {
  return entriesFor(entries, key, (entry) => entry.translatedText);
}

function entriesFor(
  entries: DictionaryEntryRecord[],
  key: string | null,
  text: (entry: DictionaryEntryRecord) => string,
): DictionaryEntryRecord[] {
  if (!key) {
    return [];
  }
  return entries
    .filter((entry) => text(entry).trim().toLocaleLowerCase() === key)
    .sort((left, right) => left.id - right.id);
}

function rowsForSide(entries: DictionaryEntryRecord[], side: Script): TranslationRow[] {
  const rows = uniqueRows(
    entries.map((entry) => ({
      entryId: entry.id,
      text: side === "en" ? entry.translatedText : entry.sourceText,
    })),
  );
  return rows.length > 0 ? rows : [{ entryId: null, text: "" }];
}

function pairKey(entry: DictionaryEntryRecord, englishSide: boolean): string {
  return (englishSide ? entry.sourceText : entry.translatedText).trim().toLocaleLowerCase();
}

function otherText(entry: DictionaryEntryRecord, englishSide: boolean): string {
  return dictionaryForm(englishSide ? entry.translatedText : entry.sourceText);
}

function knownMeanings(
  entries: DictionaryEntryRecord[],
  side: Script,
  source: string,
  originIds: number[],
): string[] {
  const key = source.trim().toLocaleLowerCase();
  if (!key) {
    return [];
  }
  const origin = new Set(originIds);
  return uniqueRows(
    entries
      .filter((entry) => !origin.has(entry.id) && pairKey(entry, side === "en") === key)
      .map((entry) => ({ entryId: null, text: otherText(entry, side === "en") })),
  ).map((row) => row.text);
}

function uniqueRows(rows: TranslationRow[]): TranslationRow[] {
  const seen = new Set<string>();
  const translations: TranslationRow[] = [];
  for (const row of rows) {
    const text = dictionaryForm(row.text);
    const key = text;
    if (!text || seen.has(key)) {
      continue;
    }
    seen.add(key);
    translations.push({ entryId: row.entryId, text });
  }
  return translations;
}
