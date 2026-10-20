import { t } from "../i18n";
import { FormEvent, RefObject, useEffect, useRef, useState } from "react";
import { confirmAction } from "../confirm";
import { Icon } from "../icons";
import {
  createDictionaryEntry,
  deleteDictionaryEntry,
  DictionaryEntryRecord,
  DictionaryScope,
  errorText,
  listDictionaryEntries,
  updateDictionaryEntry,
} from "../libraryApi";

type Draft = {
  id: number | null;
  sourceText: string;
  translatedText: string;
  note: string;
};

const emptyDraft: Draft = { id: null, sourceText: "", translatedText: "", note: "" };

type Sense = {
  ids: number[];
  translation: string;
  note: string;
};

type WordGroup = {
  key: string;
  word: string;
  senses: Sense[];
};

function dictionaryForm(text: string): string {
  return text.trim().toLocaleLowerCase();
}

function groupWords(entries: DictionaryEntryRecord[]): WordGroup[] {
  const groups = new Map<string, WordGroup>();
  for (const entry of entries) {
    const word = dictionaryForm(entry.sourceText);
    const translation = dictionaryForm(entry.translatedText);
    if (!word || !translation) {
      continue;
    }
    let group = groups.get(word);
    if (!group) {
      group = { key: word, word, senses: [] };
      groups.set(word, group);
    }
    const sense = group.senses.find((item) => item.translation === translation);
    if (sense) {
      sense.ids.push(entry.id);
      if (!sense.note && entry.note.trim()) {
        sense.note = entry.note.trim();
      }
    } else {
      group.senses.push({ ids: [entry.id], translation, note: entry.note.trim() });
    }
  }
  return [...groups.values()].sort((left, right) =>
    left.word.localeCompare(right.word, "en", { sensitivity: "base" }),
  );
}

export function ReaderDictionary({
  documentId,
  scope,
  onScope,
  revision,
}: {
  documentId: number;
  scope: DictionaryScope;
  onScope: (scope: DictionaryScope) => void;
  revision: number;
}) {
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<DictionaryEntryRecord[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const sourceRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    listDictionaryEntries(scope, scope === "document" ? documentId : null, "")
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
  }, [documentId, scope, revision]);

  useEffect(() => {
    setAdding(false);
    setDraft(emptyDraft);
  }, [scope]);

  useEffect(() => {
    if (adding || draft.id !== null) {
      sourceRef.current?.focus();
    }
  }, [adding, draft.id]);

  useEffect(() => {
    if (draft.id !== null && !entries.some((entry) => entry.id === draft.id)) {
      setDraft(emptyDraft);
    }
  }, [entries, draft.id]);

  function save(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    const request =
      draft.id === null
        ? createDictionaryEntry(
            scope,
            scope === "document" ? documentId : null,
            draft.sourceText,
            draft.translatedText,
            draft.note,
          )
        : updateDictionaryEntry(draft.id, draft.sourceText, draft.translatedText, draft.note);
    void request
      .then(() => listDictionaryEntries(scope, scope === "document" ? documentId : null, ""))
      .then((list) => {
        setEntries(list);
        setDraft(emptyDraft);
        setAdding(false);
      })
      .catch((saveError: unknown) => setError(errorText(saveError)))
      .finally(() => setPending(false));
  }

  function closeForm() {
    setDraft(emptyDraft);
    setAdding(false);
  }

  const trimmedQuery = query.trim().toLocaleLowerCase();
  const groups = groupWords(entries).filter((group) => {
    if (!trimmedQuery) {
      return true;
    }
    return (
      group.word.includes(trimmedQuery) ||
      group.senses.some(
        (sense) => sense.translation.includes(trimmedQuery) || sense.note.toLocaleLowerCase().includes(trimmedQuery),
      )
    );
  });
  const formOpen = adding || draft.id !== null;

  return (
    <div className="dictionary" data-dictionary-scope={scope}>
      <div className="dictionary-scope" role="tablist" aria-label={t("Словарь")}>
        <button
          type="button"
          role="tab"
          className={scope === "document" ? "active" : undefined}
          aria-selected={scope === "document"}
          onClick={() => onScope("document")}
        >
          {t("Эта книга")}</button>
        <button
          type="button"
          role="tab"
          className={scope === "global" ? "active" : undefined}
          aria-selected={scope === "global"}
          onClick={() => onScope("global")}
        >
          {t("Общий")}</button>
      </div>
      <p className="dictionary-hint">
        {scope === "document" ? t("Только для этой книги.") : t("Виден в любой книге.")}
      </p>
      <div className="dictionary-search">
        <input
          type="search"
          value={query}
          aria-label={t("Поиск по словарю")}
          data-dictionary-search=""
          placeholder={t("Найти слово или перевод")}
          onChange={(event) => setQuery(event.target.value)}
        />
        {query ? (
          <button
            type="button"
            className="icon-button"
            aria-label={t("Очистить поиск")}
            onClick={() => setQuery("")}
          >
            <Icon name="clear" />
          </button>
        ) : null}
      </div>
      {error ? <p className="error">{error}</p> : null}
      {draft.id !== null ? null : adding ? (
        <EntryForm
          draft={draft}
          pending={pending}
          submitLabel={t("Добавить")}
          sourceRef={sourceRef}
          onChange={setDraft}
          onSubmit={save}
          onCancel={closeForm}
        />
      ) : (
        <button
          type="button"
          className="dictionary-add"
          disabled={pending}
          onClick={() => {
            setDraft(emptyDraft);
            setAdding(true);
          }}
        >
          <Icon name="plus" />
          {t("Добавить слово")}</button>
      )}
      {entries.length === 0 ? (
        <p className="dictionary-empty">
          {scope === "document"
            ? t("В словаре этой книги пока пусто. Добавьте слово или сохраните фразу из перевода.")
            : t("Общий словарь пока пуст. Записи отсюда будут видны в любой книге.")}
        </p>
      ) : groups.length === 0 ? (
        <p className="dictionary-empty">{t("Ничего не нашлось. Попробуйте другое слово.")}</p>
      ) : (
        <>
          <p className="dictionary-summary">
            {trimmedQuery ? t("Найдено: {0}", [groups.length]) : wordCountLabel(groups.length)}
          </p>
          <ul className="side-list">
            {groups.map((group) => {
              const editing = group.senses.some((sense) => sense.ids.includes(draft.id ?? -1));
              return (
                <li
                  key={group.key}
                  className={editing ? "dictionary-card editing" : "dictionary-card"}
                  data-dictionary-word={group.key}
                >
                  <span className="dictionary-word">{group.word}</span>
                  <ul className="dictionary-senses">
                    {group.senses.map((sense) => {
                      const senseEditing = sense.ids.includes(draft.id ?? -1);
                      if (senseEditing) {
                        return (
                          <li key={sense.translation} className="editing">
                            <EntryForm
                              draft={draft}
                              pending={pending}
                              submitLabel={t("Сохранить")}
                              sourceRef={sourceRef}
                              onChange={setDraft}
                              onSubmit={save}
                              onCancel={closeForm}
                            />
                          </li>
                        );
                      }
                      const entry = entries.find((item) => item.id === sense.ids[0]);
                      return (
                        <li key={sense.translation} className="dictionary-sense">
                          <div className="dictionary-sense-text">
                            <span className="dictionary-meaning">{sense.translation}</span>
                            {sense.note ? <span className="dictionary-note">{sense.note}</span> : null}
                          </div>
                          <div className="dictionary-card-actions">
                            <button
                              type="button"
                              className="icon-button"
                              aria-label={t("Изменить {0}", [sense.translation])}
                              disabled={pending || formOpen || !entry}
                              onClick={() => {
                                if (!entry) {
                                  return;
                                }
                                setAdding(false);
                                setDraft({
                                  id: entry.id,
                                  sourceText: entry.sourceText,
                                  translatedText: entry.translatedText,
                                  note: entry.note,
                                });
                              }}
                            >
                              <Icon name="edit" />
                            </button>
                            <button
                              type="button"
                              className="icon-button"
                              aria-label={t("Удалить {0}", [sense.translation])}
                              disabled={pending || formOpen}
                              onClick={() => {
                                void (async () => {
                                  if (await confirmAction(t("Удалить этот перевод?"))) {
                                    setPending(true);
                                    setError("");
                                    void Promise.all(sense.ids.map((id) => deleteDictionaryEntry(id)))
                                      .then(() =>
                                        listDictionaryEntries(
                                          scope,
                                          scope === "document" ? documentId : null,
                                          "",
                                        ),
                                      )
                                      .then((list) => {
                                        setEntries(list);
                                        if (draft.id !== null && sense.ids.includes(draft.id)) {
                                          closeForm();
                                        }
                                      })
                                      .catch((deleteError: unknown) => setError(errorText(deleteError)))
                                      .finally(() => setPending(false));
                                  }
                                })();
                              }}
                            >
                              <Icon name="trash" />
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

function EntryForm({
  draft,
  pending,
  submitLabel,
  sourceRef,
  onChange,
  onSubmit,
  onCancel,
}: {
  draft: Draft;
  pending: boolean;
  submitLabel: string;
  sourceRef: RefObject<HTMLInputElement | null>;
  onChange: (draft: Draft) => void;
  onSubmit: (event: FormEvent) => void;
  onCancel: () => void;
}) {
  return (
    <form className="side-form dictionary-form" onSubmit={onSubmit}>
      <label>
        {t("Слово или фраза")}<input
          ref={sourceRef}
          aria-label={t("Слово или фраза")}
          data-dictionary-source=""
          autoComplete="off"
          placeholder={t("Как в книге")}
          value={draft.sourceText}
          disabled={pending}
          onChange={(event) => onChange({ ...draft, sourceText: event.target.value })}
        />
      </label>
      <label>
        {t("Перевод")}<input
          aria-label={t("Перевод слова")}
          data-dictionary-translation=""
          autoComplete="off"
          placeholder={t("Как перевести")}
          value={draft.translatedText}
          disabled={pending}
          onChange={(event) => onChange({ ...draft, translatedText: event.target.value })}
        />
      </label>
      <label>
        {t("Комментарий")}<input
          aria-label={t("Комментарий")}
          data-dictionary-note=""
          autoComplete="off"
          placeholder={t("Необязательно")}
          value={draft.note}
          disabled={pending}
          onChange={(event) => onChange({ ...draft, note: event.target.value })}
        />
      </label>
      <div className="actions">
        <button
          type="submit"
          className="primary"
          disabled={pending || draft.sourceText.trim() === "" || draft.translatedText.trim() === ""}
        >
          {submitLabel}
        </button>
        <button type="button" disabled={pending} onClick={onCancel}>
          {t("Отмена")}</button>
      </div>
    </form>
  );
}

function wordCountLabel(count: number) {
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

