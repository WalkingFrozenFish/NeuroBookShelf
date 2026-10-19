import { useEffect, useState } from "react";
import { confirmAction } from "../confirm";
import { Icon } from "../icons";
import {
  DocumentRecord,
  errorText,
  listShelves,
  listTags,
  listTrash,
  NamedRecord,
  purgeDocument,
  restoreDocument,
} from "../libraryApi";

export function TrashPage() {
  const [documents, setDocuments] = useState<DocumentRecord[] | null>(null);
  const [shelves, setShelves] = useState<NamedRecord[]>([]);
  const [tags, setTags] = useState<NamedRecord[]>([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function reload() {
    const [trashed, shelfList, tagList] = await Promise.all([
      listTrash(),
      listShelves(),
      listTags(),
    ]);
    setDocuments(trashed);
    setShelves(shelfList);
    setTags(tagList);
  }

  useEffect(() => {
    let active = true;
    Promise.all([listTrash(), listShelves(), listTags()])
      .then(([trashed, shelfList, tagList]) => {
        if (active) {
          setDocuments(trashed);
          setShelves(shelfList);
          setTags(tagList);
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

  async function run(action: () => Promise<void>) {
    setPending(true);
    setError("");
    try {
      await action();
      await reload();
    } catch (actionError: unknown) {
      setError(errorText(actionError));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="library">
      <h1>Корзина</h1>
      {error ? <p className="error">{error}</p> : null}
      {documents === null ? (
        <p>Загрузка корзины…</p>
      ) : documents.length === 0 ? (
        <p>Удалённых документов нет.</p>
      ) : (
        <ul className="records">
          {documents.map((document) => (
            <li key={document.id} data-trash-id={document.id}>
              <div>
                <strong className="book-name" title={document.title}>
                  {document.title}
                </strong>
                <div className="meta">
                  {document.originalFilename ? `Файл: ${document.originalFilename}` : "Без файла"}
                  <br />
                  Полки: {namesFor(shelves, document.shelfIds)}
                  <br />
                  Теги: {namesFor(tags, document.tagIds)}
                  {document.deletedAt ? (
                    <>
                      <br />
                      Удалён: {document.deletedAt}
                    </>
                  ) : null}
                </div>
              </div>
              <div className="actions">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => void run(() => restoreDocument(document.id).then(() => undefined))}
                >
                  <Icon name="restore" />
                  Восстановить
                </button>
                <button
                  type="button"
                  className="danger"
                  disabled={pending}
                  onClick={() => {
                    void (async () => {
                      if (
                        await confirmAction(
                          `Удалить «${document.title}» навсегда? Файл PDF будет удалён с диска, а запись исчезнет из базы. Это нельзя отменить.`,
                        )
                      ) {
                        void run(() => purgeDocument(document.id));
                      }
                    })();
                  }}
                >
                  <Icon name="trash" />
                  Удалить навсегда
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function namesFor(items: NamedRecord[], ids: number[]): string {
  const names = ids
    .map((id) => items.find((item) => item.id === id)?.name)
    .filter((name): name is string => Boolean(name));
  return names.length === 0 ? "нет" : names.join(", ");
}
