import { FormEvent, useEffect, useState } from "react";
import { confirmAction } from "../confirm";
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
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let active = true;
    listDictionaryEntries(scope, scope === "document" ? documentId : null, query)
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
  }, [documentId, scope, query, revision]);

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
      .then(() => listDictionaryEntries(scope, scope === "document" ? documentId : null, query))
      .then((list) => {
        setEntries(list);
        setDraft(emptyDraft);
      })
      .catch((saveError: unknown) => setError(errorText(saveError)))
      .finally(() => setPending(false));
  }

  return (
    <div data-dictionary-scope={scope}>
      <div className="actions" role="tablist" aria-label="Словарь">
        <button
          type="button"
          className={scope === "document" ? "active" : undefined}
          aria-selected={scope === "document"}
          onClick={() => onScope("document")}
        >
          Книга
        </button>
        <button
          type="button"
          className={scope === "global" ? "active" : undefined}
          aria-selected={scope === "global"}
          onClick={() => onScope("global")}
        >
          Общий
        </button>
      </div>
      <p className="meta">
        {scope === "document"
          ? "Записи только этой книги."
          : "Общие записи, видны в любой книге."}
      </p>
      <input
        value={query}
        aria-label="Поиск по словарю"
        data-dictionary-search=""
        placeholder="Поиск"
        onChange={(event) => setQuery(event.target.value)}
      />
      {error ? <p className="error">{error}</p> : null}
      <form className="side-form" onSubmit={save}>
        <input
          aria-label="Слово или фраза"
          data-dictionary-source=""
          value={draft.sourceText}
          disabled={pending}
          onChange={(event) => setDraft((current) => ({ ...current, sourceText: event.target.value }))}
        />
        <input
          aria-label="Перевод слова"
          data-dictionary-translation=""
          value={draft.translatedText}
          disabled={pending}
          onChange={(event) =>
            setDraft((current) => ({ ...current, translatedText: event.target.value }))
          }
        />
        <input
          aria-label="Комментарий"
          data-dictionary-note=""
          value={draft.note}
          disabled={pending}
          onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))}
        />
        <div className="actions">
          <button
            type="submit"
            disabled={pending || draft.sourceText.trim() === "" || draft.translatedText.trim() === ""}
          >
            {draft.id === null ? "Добавить" : "Сохранить"}
          </button>
          {draft.id !== null ? (
            <button type="button" disabled={pending} onClick={() => setDraft(emptyDraft)}>
              Отмена
            </button>
          ) : null}
        </div>
      </form>
      {entries.length === 0 ? (
        <p className="meta">Записей нет.</p>
      ) : (
        <ul className="side-list">
          {entries.map((entry) => (
            <li key={entry.id} data-dictionary-id={entry.id}>
              <strong>{entry.sourceText}</strong>
              <span>{entry.translatedText}</span>
              {entry.note ? <span className="meta">{entry.note}</span> : null}
              <div className="actions">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    setDraft({
                      id: entry.id,
                      sourceText: entry.sourceText,
                      translatedText: entry.translatedText,
                      note: entry.note,
                    })
                  }
                >
                  Изменить
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    void (async () => {
                    if (await confirmAction("Удалить запись словаря?")) {
                      setPending(true);
                      setError("");
                      void deleteDictionaryEntry(entry.id)
                        .then(() => listDictionaryEntries(scope, scope === "document" ? documentId : null, query))
                        .then((list) => {
                          setEntries(list);
                          if (draft.id === entry.id) {
                            setDraft(emptyDraft);
                          }
                        })
                        .catch((deleteError: unknown) => setError(errorText(deleteError)))
                        .finally(() => setPending(false));
                    }
                    })();
                  }}
                >
                  Удалить
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
