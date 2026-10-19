import { FormEvent, useEffect, useState } from "react";
import { confirmAction } from "../confirm";
import { Icon } from "../icons";
import {
  BookmarkRecord,
  createBookmark,
  createDictionaryEntry,
  createNote,
  deleteBookmark,
  deleteNote,
  DictionaryScope,
  activateTranslationVersion,
  deleteTranslationBlock,
  errorText,
  listBookmarks,
  listNotes,
  listTranslationBlocks,
  listTranslationVersions,
  NoteRecord,
  retranslateTranslationBlock,
  TranslationBlockRecord,
  TranslationVersionRecord,
  updateNote,
  updateTranslationBlock,
} from "../libraryApi";
import { ReaderDictionary } from "./ReaderDictionary";

type TabId = "notes" | "bookmarks" | "translations" | "dictionary";

type Editing = {
  id: number;
  pageNumber: number | null;
  body: string;
};

export function ReaderSidePanel({
  width,
  onResizeStart,
  documentId,
  pageNumber,
  onOpenPage,
  onDirtyChange,
  blocksVersion,
  highlightedId,
  onHighlight,
  onShowOverlay,
  onShowPopup,
  onBlocksChanged,
}: {
  width: number;
  onResizeStart: (event: React.PointerEvent<HTMLDivElement>) => void;
  documentId: number;
  pageNumber: number;
  onOpenPage: (pageNumber: number) => void;
  onDirtyChange: (pageDirty: boolean, anyDirty: boolean) => void;
  blocksVersion: number;
  highlightedId: number | null;
  onHighlight: (block: TranslationBlockRecord) => void;
  onShowOverlay: () => void;
  onShowPopup: (id: number) => void;
  onBlocksChanged: () => void;
}) {
  const [tab, setTab] = useState<TabId>("notes");
  const [bookmarks, setBookmarks] = useState<BookmarkRecord[]>([]);
  const [notes, setNotes] = useState<NoteRecord[]>([]);
  const [label, setLabel] = useState("");
  const [documentDraft, setDocumentDraft] = useState("");
  const [pageDraft, setPageDraft] = useState("");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [blocks, setBlocks] = useState<TranslationBlockRecord[]>([]);
  const [blockError, setBlockError] = useState("");
  const [blockPending, setBlockPending] = useState(false);
  const [blockEdit, setBlockEdit] = useState<{ id: number; ocrText: string; translatedText: string } | null>(null);
  const [expanded, setExpanded] = useState<number[]>([]);
  const [historyId, setHistoryId] = useState<number | null>(null);
  const [versions, setVersions] = useState<TranslationVersionRecord[]>([]);
  const [retranslateId, setRetranslateId] = useState<number | null>(null);
  const [retranslateFailed, setRetranslateFailed] = useState(false);
  const [dictionaryScope, setDictionaryScope] = useState<DictionaryScope>("document");
  const [dictionaryRevision, setDictionaryRevision] = useState(0);

  const editingNote = editing ? notes.find((note) => note.id === editing.id) : undefined;
  const editingDirty = Boolean(editing && editingNote && editing.body !== editingNote.body);
  const pageEditDirty = Boolean(
    editingDirty && editingNote && editingNote.pageNumber === pageNumber,
  );
  const documentEditDirty = Boolean(editingDirty && editingNote && editingNote.pageNumber === null);
  const pageDirty = pageDraft.trim() !== "" || pageEditDirty;
  const anyDirty = pageDirty || documentDraft.trim() !== "" || documentEditDirty;

  useEffect(() => {
    onDirtyChange(pageDirty, anyDirty);
  }, [pageDirty, anyDirty, onDirtyChange]);

  useEffect(() => {
    setPageDraft("");
    setEditing((current) => {
      if (!current || current.pageNumber === null || current.pageNumber === pageNumber) {
        return current;
      }
      return null;
    });
  }, [pageNumber]);

  useEffect(() => {
    let active = true;
    setError("");
    setLabel("");
    setDocumentDraft("");
    setPageDraft("");
    setEditing(null);
    Promise.all([listBookmarks(documentId), listNotes(documentId)])
      .then(([bookmarkList, noteList]) => {
        if (active) {
          setBookmarks(bookmarkList);
          setNotes(noteList);
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
  }, [documentId]);

  useEffect(() => {
    let active = true;
    setBlockError("");
    setBlockEdit(null);
    listTranslationBlocks(documentId, pageNumber)
      .then((list) => {
        if (active) {
          setBlocks(list);
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setBlocks([]);
          setBlockError(errorText(loadError));
        }
      });
    return () => {
      active = false;
    };
  }, [documentId, pageNumber, blocksVersion]);

  async function run(action: () => Promise<void>) {
    setPending(true);
    setError("");
    try {
      await action();
      const [bookmarkList, noteList] = await Promise.all([
        listBookmarks(documentId),
        listNotes(documentId),
      ]);
      setBookmarks(bookmarkList);
      setNotes(noteList);
    } catch (actionError: unknown) {
      setError(errorText(actionError));
    } finally {
      setPending(false);
    }
  }

  function addBookmark(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      await createBookmark(documentId, pageNumber, label);
      setLabel("");
    });
  }

  function addNote(event: FormEvent, scope: "document" | "page") {
    event.preventDefault();
    const draft = scope === "document" ? documentDraft : pageDraft;
    void run(async () => {
      await createNote(documentId, scope === "document" ? null : pageNumber, draft);
      if (scope === "document") {
        setDocumentDraft("");
      } else {
        setPageDraft("");
      }
    });
  }

  function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (!editing) {
      return;
    }
    const body = editing.body;
    const id = editing.id;
    void run(async () => {
      await updateNote(id, body);
      setEditing(null);
    });
  }

  function addBlockToDictionary(scope: DictionaryScope, block: TranslationBlockRecord) {
    setBlockPending(true);
    setBlockError("");
    setRetranslateFailed(false);
    void createDictionaryEntry(
      scope,
      scope === "document" ? documentId : null,
      block.ocrText,
      block.translatedText,
      "",
    )
      .then(() => {
        setDictionaryScope(scope);
        setDictionaryRevision((current) => current + 1);
        setTab("dictionary");
      })
      .catch((saveError: unknown) => setBlockError(errorText(saveError)))
      .finally(() => setBlockPending(false));
  }

  const documentNotes = notes.filter((note) => note.pageNumber === null);
  const pageNotes = notes.filter((note) => note.pageNumber === pageNumber);

  return (
    <aside className="reader-side" aria-label="Дополнительная панель">
      <div
        className="side-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="Ширина панели"
        aria-valuemin={300}
        aria-valuemax={500}
        aria-valuenow={width}
        title="Потяните, чтобы изменить ширину"
        onPointerDown={onResizeStart}
      >
        ⋮
      </div>
      <div className="side-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "notes"}
          className={tab === "notes" ? "active" : undefined}
          onClick={() => setTab("notes")}
        >
          <Icon name="notes" />
          Заметки
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "bookmarks"}
          className={tab === "bookmarks" ? "active" : undefined}
          onClick={() => setTab("bookmarks")}
        >
          <Icon name="bookmark" />
          Закладки
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "translations"}
          className={tab === "translations" ? "active" : undefined}
          onClick={() => setTab("translations")}
        >
          <Icon name="translate" />
          Переводы
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "dictionary"}
          className={tab === "dictionary" ? "active" : undefined}
          onClick={() => setTab("dictionary")}
        >
          <Icon name="dictionary" />
          Словарь
        </button>
      </div>
      <div className="side-body" hidden={tab !== "notes"}>
        {error && tab === "notes" ? <p className="error">{error}</p> : null}
        <section>
          <h2>Заметки документа</h2>
          <p className="meta">Общие, видны на любой странице.</p>
          <NoteList
            notes={documentNotes}
            scopeLabel="Общая"
            pending={pending}
            editing={editing}
            onEdit={setEditing}
            onEditBody={(body) => setEditing((current) => (current ? { ...current, body } : current))}
            onSave={saveEdit}
            onCancel={() => setEditing(null)}
            onDelete={(id) => {
              void (async () => {
                if (await confirmAction("Удалить заметку?")) {
                  void run(() => deleteNote(id));
                }
              })();
            }}
          />
          <form className="side-form" onSubmit={(event) => addNote(event, "document")}>
            <textarea
              value={documentDraft}
              placeholder="Новая общая заметка"
              disabled={pending}
              onChange={(event) => setDocumentDraft(event.target.value)}
            />
            <button type="submit" disabled={pending || documentDraft.trim() === ""}>
              Сохранить
            </button>
          </form>
        </section>
        <section>
          <h2>Заметки страницы {pageNumber}</h2>
          <p className="meta">Только для этой страницы.</p>
          <NoteList
            notes={pageNotes}
            scopeLabel={`Страница ${pageNumber}`}
            pending={pending}
            editing={editing}
            onEdit={setEditing}
            onEditBody={(body) => setEditing((current) => (current ? { ...current, body } : current))}
            onSave={saveEdit}
            onCancel={() => setEditing(null)}
            onDelete={(id) => {
              void (async () => {
                if (await confirmAction("Удалить заметку?")) {
                  void run(() => deleteNote(id));
                }
              })();
            }}
          />
          <form className="side-form" onSubmit={(event) => addNote(event, "page")}>
            <textarea
              data-page-note
              value={pageDraft}
              placeholder={`Заметка к странице ${pageNumber}`}
              disabled={pending}
              onChange={(event) => setPageDraft(event.target.value)}
            />
            <button type="submit" disabled={pending || pageDraft.trim() === ""}>
              Сохранить
            </button>
          </form>
        </section>
      </div>
      <div className="side-body" hidden={tab !== "bookmarks"}>
        {error && tab === "bookmarks" ? <p className="error">{error}</p> : null}
        <form className="side-form" onSubmit={addBookmark}>
          <input
            value={label}
            placeholder="Название, необязательно"
            disabled={pending}
            onChange={(event) => setLabel(event.target.value)}
          />
          <button type="submit" disabled={pending}>
            Добавить закладку
          </button>
        </form>
        {bookmarks.length === 0 ? (
          <p className="meta">Закладок пока нет.</p>
        ) : (
          <ul className="side-list">
            {bookmarks.map((bookmark) => (
              <li
                key={bookmark.id}
                data-bookmark-id={bookmark.id}
                data-bookmark-page={bookmark.pageNumber}
                className={bookmark.pageNumber === pageNumber ? "current" : undefined}
              >
                <button type="button" onClick={() => onOpenPage(bookmark.pageNumber)}>
                  <strong>{bookmark.label || `Страница ${bookmark.pageNumber}`}</strong>
                  <span className="meta">стр. {bookmark.pageNumber}</span>
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    void (async () => {
                      if (await confirmAction("Удалить закладку?")) {
                        void run(() => deleteBookmark(bookmark.id));
                      }
                    })();
                  }}
                >
                  Удалить
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="side-body" hidden={tab !== "translations"}>
        {blockError ? (
          <p className="error" data-retranslate-state={retranslateFailed ? "error" : undefined}>
            {blockError}
          </p>
        ) : null}
        {blocks.length === 0 ? (
          <p className="meta">На этой странице переводов нет.</p>
        ) : (
          <ul className="side-list">
            {blocks.map((block) => {
              const active = blockEdit?.id === block.id;
              const open = expanded.includes(block.id);
              return (
                <li
                  key={block.id}
                  data-translation-id={block.id}
                  className={highlightedId === block.id ? "highlighted" : undefined}
                >
                  {active && blockEdit ? (
                    <form
                      className="side-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const draft = blockEdit;
                        setBlockPending(true);
                        setBlockError("");
                        void updateTranslationBlock(draft.id, draft.ocrText, draft.translatedText)
                          .then(() => listTranslationBlocks(documentId, pageNumber))
                          .then((list) => {
                            setBlocks(list);
                            setBlockEdit(null);
                            onBlocksChanged();
                            if (historyId === draft.id) {
                              return listTranslationVersions(draft.id).then(setVersions);
                            }
                            return undefined;
                          })
                          .catch((saveError: unknown) => setBlockError(errorText(saveError)))
                          .finally(() => setBlockPending(false));
                      }}
                    >
                      <textarea
                        aria-label="Исходный текст"
                        data-edit-ocr
                        value={blockEdit.ocrText}
                        disabled={blockPending}
                        onChange={(event) =>
                          setBlockEdit((current) =>
                            current ? { ...current, ocrText: event.target.value } : current,
                          )
                        }
                      />
                      <textarea
                        aria-label="Перевод блока"
                        data-edit-translation
                        value={blockEdit.translatedText}
                        disabled={blockPending}
                        onChange={(event) =>
                          setBlockEdit((current) =>
                            current ? { ...current, translatedText: event.target.value } : current,
                          )
                        }
                      />
                      <div className="actions">
                        <button
                          type="submit"
                          disabled={
                            blockPending ||
                            blockEdit.ocrText.trim() === "" ||
                            blockEdit.translatedText.trim() === ""
                          }
                        >
                          Сохранить
                        </button>
                        <button type="button" disabled={blockPending} onClick={() => setBlockEdit(null)}>
                          Отмена
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="block-open"
                        onClick={() => {
                          onShowOverlay();
                          onHighlight(block);
                        }}
                      >
                        <strong>{`#${block.id}`}</strong>
                        <span className={open ? "block-text" : "block-text clamp"}>{block.ocrText}</span>
                        <span className={open ? "block-text" : "block-text clamp"}>{block.translatedText}</span>
                      </button>
                      <div className="actions">
                        <button
                          type="button"
                          onClick={() => {
                            onHighlight(block);
                            onShowPopup(block.id);
                          }}
                        >
                          <Icon name="overlay" />
                          Показать
                        </button>
                        {block.ocrText.length > 140 || block.translatedText.length > 140 ? (
                          <button
                            type="button"
                            onClick={() =>
                              setExpanded((current) =>
                                current.includes(block.id)
                                  ? current.filter((id) => id !== block.id)
                                  : [...current, block.id],
                              )
                            }
                          >
                            {open ? "Свернуть" : "Ещё"}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          disabled={blockPending || retranslateId !== null}
                          data-retranslate={block.id}
                          onClick={() => {
                            setRetranslateId(block.id);
                            setRetranslateFailed(false);
                            setBlockError("");
                            void retranslateTranslationBlock(block.id)
                              .then(() => listTranslationBlocks(documentId, pageNumber))
                              .then((list) => {
                                setBlocks(list);
                                onBlocksChanged();
                                if (historyId === block.id) {
                                  return listTranslationVersions(block.id).then(setVersions);
                                }
                                return undefined;
                              })
                              .catch((retranslateError: unknown) => {
                                setRetranslateFailed(true);
                                setBlockError(errorText(retranslateError));
                              })
                              .finally(() => setRetranslateId(null));
                          }}
                        >
                          Перевести заново
                        </button>
                        {retranslateId === block.id ? (
                          <span data-retranslate-state="loading">Перевод…</span>
                        ) : null}
                        <button
                          type="button"
                          disabled={blockPending}
                          onClick={() => {
                            if (historyId === block.id) {
                              setHistoryId(null);
                              setVersions([]);
                              return;
                            }
                            setBlockError("");
                            setRetranslateFailed(false);
                            void listTranslationVersions(block.id)
                              .then((list) => {
                                setHistoryId(block.id);
                                setVersions(list);
                              })
                              .catch((historyError: unknown) => setBlockError(errorText(historyError)));
                          }}
                        >
                          Версии
                        </button>
                        <button
                          type="button"
                          disabled={blockPending}
                          onClick={() =>
                            setBlockEdit({
                              id: block.id,
                              ocrText: block.ocrText,
                              translatedText: block.translatedText,
                            })
                          }
                        >
                          Изменить
                        </button>
                        <button
                          type="button"
                          disabled={blockPending}
                          onClick={() => addBlockToDictionary("document", block)}
                        >
                          В словарь книги
                        </button>
                        <button
                          type="button"
                          disabled={blockPending}
                          onClick={() => addBlockToDictionary("global", block)}
                        >
                          В общий словарь
                        </button>
                        <button
                          type="button"
                          disabled={blockPending}
                          onClick={() => {
                            void (async () => {
                            if (await confirmAction("Удалить перевод?")) {
                              setBlockPending(true);
                              setBlockError("");
                              void deleteTranslationBlock(block.id)
                                .then(() => listTranslationBlocks(documentId, pageNumber))
                                .then((list) => {
                                  setBlocks(list);
                                  if (blockEdit?.id === block.id) {
                                    setBlockEdit(null);
                                  }
                                  if (historyId === block.id) {
                                    setHistoryId(null);
                                    setVersions([]);
                                  }
                                  onBlocksChanged();
                                })
                                .catch((deleteError: unknown) => setBlockError(errorText(deleteError)))
                                .finally(() => setBlockPending(false));
                            }
                            })();
                          }}
                        >
                          Удалить
                        </button>
                      </div>
                      {historyId === block.id ? (
                        <ul className="version-list" data-version-list={block.id}>
                          {versions.map((version) => (
                            <li
                              key={version.id}
                              data-version-id={version.id}
                              data-version-active={version.isActive ? "true" : "false"}
                              data-translator={version.translator}
                            >
                              <span className="meta">{version.createdAt}</span>
                              <span>{engineLabel(version.translator)}</span>
                              <span>{preview(version.translatedText)}</span>
                              {version.isActive ? <strong>Активная</strong> : null}
                              {version.isActive ? null : (
                                <button
                                  type="button"
                                  disabled={blockPending}
                                  onClick={() => {
                                    setBlockPending(true);
                                    setBlockError("");
                                    setRetranslateFailed(false);
                                    void activateTranslationVersion(version.id)
                                      .then(() => listTranslationBlocks(documentId, pageNumber))
                                      .then((list) => {
                                        setBlocks(list);
                                        onBlocksChanged();
                                        return listTranslationVersions(block.id);
                                      })
                                      .then(setVersions)
                                      .catch((activateError: unknown) => setBlockError(errorText(activateError)))
                                      .finally(() => setBlockPending(false));
                                  }}
                                >
                                  Сделать активной
                                </button>
                              )}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="side-body" hidden={tab !== "dictionary"}>
        <ReaderDictionary
          documentId={documentId}
          scope={dictionaryScope}
          onScope={setDictionaryScope}
          revision={dictionaryRevision}
        />
      </div>
    </aside>
  );
}

function engineLabel(translator: string): string {
  if (translator === "manual") {
    return "ручная правка";
  }
  if (translator === "legacy") {
    return "сохранённый перевод";
  }
  if (translator === "ctranslate2:en-ru") {
    return "локальный en→ru";
  }
  return translator;
}

function preview(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > 80 ? `${compact.slice(0, 80)}…` : compact;
}

function NoteList({
  notes,
  scopeLabel,
  pending,
  editing,
  onEdit,
  onEditBody,
  onSave,
  onCancel,
  onDelete,
}: {
  notes: NoteRecord[];
  scopeLabel: string;
  pending: boolean;
  editing: Editing | null;
  onEdit: (editing: Editing) => void;
  onEditBody: (body: string) => void;
  onSave: (event: FormEvent) => void;
  onCancel: () => void;
  onDelete: (id: number) => void;
}) {
  if (notes.length === 0) {
    return <p className="meta">Заметок пока нет.</p>;
  }
  return (
    <ul className="side-list">
      {notes.map((note) => {
        const active = editing?.id === note.id;
        return (
          <li key={note.id} data-note-id={note.id} data-note-scope={note.pageNumber === null ? "document" : "page"}>
            <span className="meta">{scopeLabel}</span>
            {active ? (
              <form className="side-form" onSubmit={onSave}>
                <textarea
                  value={editing.body}
                  disabled={pending}
                  onChange={(event) => onEditBody(event.target.value)}
                />
                <div className="actions">
                  <button type="submit" disabled={pending || editing.body.trim() === ""}>
                    Сохранить
                  </button>
                  <button type="button" disabled={pending} onClick={onCancel}>
                    Отмена
                  </button>
                </div>
              </form>
            ) : (
              <>
                <p>{note.body}</p>
                <div className="actions">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      onEdit({ id: note.id, pageNumber: note.pageNumber, body: note.body })
                    }
                  >
                    Изменить
                  </button>
                  <button type="button" disabled={pending} onClick={() => onDelete(note.id)}>
                    Удалить
                  </button>
                </div>
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}
