use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, OptionalExtension};
use sha2::{Digest, Sha256};

use crate::db::{self, Document};
use crate::storage;

struct Book {
    title: &'static str,
    shelves: &'static [&'static str],
    tags: &'static [&'static str],
    pages: &'static [&'static [&'static str]],
    bookmark: Option<&'static str>,
    note: Option<&'static str>,
    last_page: i64,
    trash: bool,
}

struct Counts {
    books: usize,
    trashed: usize,
    shelves: usize,
    tags: usize,
    words: usize,
}

pub fn seed_mock_library(
    conn: &Connection,
    documents_dir: &Path,
    trash_dir: &Path,
) -> Result<String, String> {
    let mut counts = Counts {
        books: 0,
        trashed: 0,
        shelves: 0,
        tags: 0,
        words: 0,
    };
    let mut shelves = HashMap::new();
    for name in ["Художественное", "Наука", "Учебники"] {
        let (id, created) = ensure_shelf(conn, name)?;
        shelves.insert(name, id);
        if created {
            counts.shelves += 1;
        }
    }
    let mut tags = HashMap::new();
    for name in ["английский", "избранное", "черновик", "классика"]
    {
        let (id, created) = ensure_tag(conn, name)?;
        tags.insert(name, id);
        if created {
            counts.tags += 1;
        }
    }
    for book in catalog() {
        if store_book(conn, documents_dir, trash_dir, &book, &shelves, &tags)? {
            if book.trash {
                counts.trashed += 1;
            } else {
                counts.books += 1;
            }
        }
    }
    counts.words = store_words(conn)?;
    Ok(summary(&counts))
}

fn summary(counts: &Counts) -> String {
    if counts.books == 0
        && counts.trashed == 0
        && counts.shelves == 0
        && counts.tags == 0
        && counts.words == 0
    {
        return "Примеры уже есть. Новые записи не добавлены.".to_string();
    }
    format!(
        "Добавлено: книги {}, корзина {}, полки {}, теги {}, слова {}.",
        counts.books, counts.trashed, counts.shelves, counts.tags, counts.words
    )
}

fn ensure_shelf(conn: &Connection, name: &str) -> Result<(i64, bool), String> {
    if let Some(id) = named_id(conn, "shelves", name)? {
        return Ok((id, false));
    }
    Ok((db::create_shelf(conn, name)?.id, true))
}

fn ensure_tag(conn: &Connection, name: &str) -> Result<(i64, bool), String> {
    if let Some(id) = named_id(conn, "tags", name)? {
        return Ok((id, false));
    }
    Ok((db::create_tag(conn, name)?.id, true))
}

fn named_id(conn: &Connection, table: &str, name: &str) -> Result<Option<i64>, String> {
    let sql = match table {
        "shelves" => "SELECT id FROM shelves WHERE name = ?1",
        "tags" => "SELECT id FROM tags WHERE name = ?1",
        _ => return Err("Неизвестная таблица".to_string()),
    };
    conn.query_row(sql, [name], |row| row.get(0))
        .optional()
        .map_err(|err| format!("Не удалось прочитать «{name}»: {err}"))
}

fn store_book(
    conn: &Connection,
    documents_dir: &Path,
    trash_dir: &Path,
    book: &Book,
    shelves: &HashMap<&str, i64>,
    tags: &HashMap<&str, i64>,
) -> Result<bool, String> {
    if title_exists(conn, book.title)? {
        return Ok(false);
    }
    fs::create_dir_all(documents_dir)
        .map_err(|err| format!("Не удалось создать каталог библиотеки: {err}"))?;
    let internal = unique_pdf_name(documents_dir)?;
    let destination = documents_dir.join(&internal);
    let bytes = build_pdf(book.title, book.pages);
    if let Err(err) = fs::write(&destination, &bytes) {
        return Err(format!("Не удалось сохранить PDF: {err}"));
    }
    let document = match db::insert_imported_document(
        conn,
        book.title,
        &format!("{}.pdf", book.title),
        &internal,
        &destination,
        bytes.len() as i64,
        &sha256_hex(&bytes),
    ) {
        Ok(document) => document,
        Err(err) => {
            let _ = fs::remove_file(&destination);
            return Err(err);
        }
    };
    if let Err(err) = finish_book(
        conn,
        documents_dir,
        trash_dir,
        book,
        &document,
        shelves,
        tags,
    ) {
        let _ = db::delete_document(conn, document.id);
        let _ = fs::remove_file(&destination);
        return Err(err);
    }
    Ok(true)
}

fn finish_book(
    conn: &Connection,
    documents_dir: &Path,
    trash_dir: &Path,
    book: &Book,
    document: &Document,
    shelves: &HashMap<&str, i64>,
    tags: &HashMap<&str, i64>,
) -> Result<(), String> {
    let shelf_ids = ids_for(book.shelves, shelves)?;
    let tag_ids = ids_for(book.tags, tags)?;
    db::update_document(conn, document.id, book.title, &shelf_ids, &tag_ids)?;
    if book.last_page > 1 {
        db::save_reading_state(conn, document.id, book.last_page, "fit-width")?;
    }
    if let Some(label) = book.bookmark {
        db::create_bookmark(conn, document.id, 1, label)?;
    }
    if let Some(body) = book.note {
        db::create_note(conn, document.id, Some(1), body)?;
    }
    if book.trash {
        storage::trash_document(conn, document.id, documents_dir, trash_dir)?;
    }
    Ok(())
}

fn ids_for(names: &[&str], known: &HashMap<&str, i64>) -> Result<Vec<i64>, String> {
    names
        .iter()
        .map(|name| {
            known
                .get(name)
                .copied()
                .ok_or_else(|| format!("«{name}» не подготовлено для примера"))
        })
        .collect()
}

fn title_exists(conn: &Connection, title: &str) -> Result<bool, String> {
    conn.query_row(
        "SELECT id FROM documents WHERE title = ?1 LIMIT 1",
        [title],
        |row| row.get::<_, i64>(0),
    )
    .optional()
    .map(|id| id.is_some())
    .map_err(|err| format!("Не удалось проверить книгу «{title}»: {err}"))
}

fn store_words(conn: &Connection) -> Result<usize, String> {
    let mut added = 0;
    for (source, translation) in words() {
        if word_exists(conn, source)? {
            continue;
        }
        db::create_dictionary_entry(conn, "global", None, source, translation, "")?;
        added += 1;
    }
    Ok(added)
}

fn word_exists(conn: &Connection, source: &str) -> Result<bool, String> {
    conn.query_row(
        "SELECT dictionary_entries.id
         FROM dictionary_entries
         JOIN dictionaries ON dictionaries.id = dictionary_entries.dictionary_id
         WHERE dictionaries.kind = 'global'
           AND lower(dictionary_entries.source_text) = lower(?1)
         LIMIT 1",
        [source],
        |row| row.get::<_, i64>(0),
    )
    .optional()
    .map(|id| id.is_some())
    .map_err(|err| format!("Не удалось проверить слово «{source}»: {err}"))
}

fn unique_pdf_name(documents_dir: &Path) -> Result<String, String> {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    for _ in 0..10 {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| "Не удалось выбрать имя для PDF".to_string())?
            .as_nanos();
        let name = format!("mock-{nanos}-{}.pdf", NEXT.fetch_add(1, Ordering::Relaxed));
        if !documents_dir.join(&name).exists() {
            return Ok(name);
        }
    }
    Err("Не удалось выбрать имя для PDF".to_string())
}

fn sha256_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let digest = Sha256::digest(bytes);
    let mut encoded = String::with_capacity(digest.len() * 2);
    for byte in digest {
        encoded.push(HEX[(byte >> 4) as usize] as char);
        encoded.push(HEX[(byte & 0x0f) as usize] as char);
    }
    encoded
}

fn build_pdf(title: &str, pages: &[&[&str]]) -> Vec<u8> {
    let page_count = pages.len();
    let mut kids = String::from("[");
    let mut bodies = Vec::with_capacity(page_count * 2);
    for (index, lines) in pages.iter().enumerate() {
        let content_id = 4 + index * 2;
        let page_id = content_id + 1;
        if index > 0 {
            kids.push(' ');
        }
        kids.push_str(&format!("{page_id} 0 R"));
        let stream = page_stream(title, lines);
        bodies.push(
            format!("<< /Length {} >>\nstream\n{stream}endstream", stream.len()).into_bytes(),
        );
        bodies.push(
            format!(
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents {content_id} 0 R /Resources << /Font << /F1 3 0 R >> >> >>"
            )
            .into_bytes(),
        );
    }
    kids.push(']');
    let mut objects = vec![
        b"<< /Type /Catalog /Pages 2 0 R >>".to_vec(),
        format!("<< /Type /Pages /Count {page_count} /Kids {kids} >>").into_bytes(),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_vec(),
    ];
    objects.append(&mut bodies);
    serialize_pdf(objects)
}

fn page_stream(title: &str, lines: &[&str]) -> String {
    let mut ops = format!(
        "BT\n/F1 20 Tf\n72 730 Td\n({}) Tj\n/F1 12 Tf\n",
        pdf_escape(title)
    );
    for (index, line) in lines.iter().enumerate() {
        if index == 0 {
            ops.push_str("0 -36 Td\n");
        } else {
            ops.push_str("0 -18 Td\n");
        }
        ops.push('(');
        ops.push_str(&pdf_escape(line));
        ops.push_str(") Tj\n");
    }
    ops.push_str("ET\n");
    ops
}

fn pdf_escape(text: &str) -> String {
    let mut escaped = String::new();
    for ch in text.chars() {
        match ch {
            '\\' | '(' | ')' => {
                escaped.push('\\');
                escaped.push(ch);
            }
            ch if ch.is_ascii() && !ch.is_control() => escaped.push(ch),
            _ => escaped.push('?'),
        }
    }
    escaped
}

fn serialize_pdf(objects: Vec<Vec<u8>>) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(b"%PDF-1.4\n");
    let mut offsets = Vec::with_capacity(objects.len());
    for (index, object) in objects.iter().enumerate() {
        offsets.push(out.len());
        out.extend_from_slice(format!("{} 0 obj\n", index + 1).as_bytes());
        out.extend_from_slice(object);
        out.extend_from_slice(b"\nendobj\n");
    }
    let xref = out.len();
    let size = objects.len() + 1;
    out.extend_from_slice(format!("xref\n0 {size}\n").as_bytes());
    out.extend_from_slice(b"0000000000 65535 f \n");
    for offset in offsets {
        out.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
    }
    out.extend_from_slice(
        format!("trailer\n<< /Size {size} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n").as_bytes(),
    );
    out
}

fn catalog() -> Vec<Book> {
    vec![
        Book {
            title: "Morning in the Library",
            shelves: &["Художественное"],
            tags: &["английский", "избранное"],
            bookmark: Some("Начало"),
            note: Some("Тихое утро: вернуться ко второй странице и к слову library."),
            last_page: 1,
            trash: false,
            pages: &[
                &[
                    "The library was quiet in the morning.",
                    "A notebook lay open beside a cup of tea.",
                    "Rain touched the glass, and the orchard",
                    "outside looked green and still.",
                ],
                &[
                    "She copied one sentence about a journey,",
                    "then another about kindness.",
                    "The dictionary on the shelf listed book,",
                    "coast, field, harbor, and winter.",
                ],
            ],
        },
        Book {
            title: "Notes on Quiet Cities",
            shelves: &["Художественное"],
            tags: &["английский", "классика"],
            bookmark: None,
            note: None,
            last_page: 1,
            trash: false,
            pages: &[
                &[
                    "Quiet streets kept their evening light.",
                    "A window above the bookshop stayed open,",
                    "and ink dried slowly on the page.",
                ],
                &[
                    "Travel here meant walking, not rushing.",
                    "The city felt like a long sentence",
                    "with room enough for one more word.",
                ],
            ],
        },
        Book {
            title: "The Glass Orchard",
            shelves: &["Художественное"],
            tags: &["английский", "избранное"],
            bookmark: Some("Сад"),
            note: None,
            last_page: 2,
            trash: false,
            pages: &[
                &[
                    "The glass orchard shone after the rain.",
                    "Each tree held a small morning light,",
                    "and the path was soft underfoot.",
                ],
                &[
                    "She left the notebook on a bench.",
                    "A short journey home could wait",
                    "until the evening turned quiet.",
                ],
            ],
        },
        Book {
            title: "Letters from the Coast",
            shelves: &["Художественное"],
            tags: &["классика"],
            bookmark: None,
            note: Some("Письмо с берега: отметить harbor и coast."),
            last_page: 1,
            trash: false,
            pages: &[
                &[
                    "The coast was a thin line of light.",
                    "Boats waited in the harbor,",
                    "and the field beyond stayed green.",
                ],
                &[
                    "His letter spoke of winter travel",
                    "and of kindness received in a storm.",
                    "He signed it beside the open book.",
                ],
            ],
        },
        Book {
            title: "Field Guide to Small Words",
            shelves: &["Наука"],
            tags: &["английский"],
            bookmark: Some("Поле"),
            note: None,
            last_page: 1,
            trash: false,
            pages: &[
                &[
                    "This field guide keeps small words:",
                    "book, library, dictionary, sentence.",
                    "Each one is enough for a note.",
                ],
                &[
                    "Write the word, then the quiet around it.",
                    "A morning page can hold a journey",
                    "if the ink stays clear.",
                ],
            ],
        },
        Book {
            title: "Winter Experiments",
            shelves: &["Наука"],
            tags: &["английский", "черновик"],
            bookmark: None,
            note: Some("Черновик: сравнить winter и evening на второй странице."),
            last_page: 1,
            trash: false,
            pages: &[
                &[
                    "The winter experiments began at dusk.",
                    "Glass jars lined the window,",
                    "and the notebook filled with numbers.",
                ],
                &[
                    "By evening the ink had frozen once.",
                    "The result was simple: cold slows",
                    "a sentence, but does not erase it.",
                ],
            ],
        },
        Book {
            title: "A Short Grammar of Rain",
            shelves: &["Учебники"],
            tags: &["английский"],
            bookmark: None,
            note: None,
            last_page: 1,
            trash: false,
            pages: &[
                &[
                    "Rain has a short grammar of its own.",
                    "A drop is a word, a storm a paragraph,",
                    "and the quiet after is a full stop.",
                ],
                &[
                    "Students copy one sentence each morning.",
                    "Then they look up journey, kindness,",
                    "and library in the dictionary.",
                ],
            ],
        },
        Book {
            title: "Maps of Ordinary Days",
            shelves: &["Учебники"],
            tags: &["избранное"],
            bookmark: Some("Карта"),
            note: None,
            last_page: 2,
            trash: false,
            pages: &[
                &[
                    "Ordinary days need ordinary maps.",
                    "Mark the library, the harbor, the field,",
                    "and the coast road home.",
                ],
                &[
                    "The second page is only a margin.",
                    "Leave room for tea, a notebook,",
                    "and one question about the journey.",
                ],
            ],
        },
        Book {
            title: "Untitled Margin",
            shelves: &[],
            tags: &["черновик"],
            bookmark: None,
            note: Some("Книга без полки: черновик на полях."),
            last_page: 1,
            trash: false,
            pages: &[
                &[
                    "This page is only a margin.",
                    "No shelf, just a quiet notebook",
                    "and a sentence waiting for ink.",
                ],
                &[
                    "Morning light, a glass of water,",
                    "and the dictionary still closed.",
                    "The journey can start tomorrow.",
                ],
            ],
        },
        Book {
            title: "Unfinished Draft",
            shelves: &["Учебники"],
            tags: &["черновик"],
            bookmark: Some("Черновик"),
            note: Some("Незаконченный черновик, оставлен в корзине."),
            last_page: 1,
            trash: true,
            pages: &[
                &[
                    "The draft stops in the middle.",
                    "A sentence about rain and glass",
                    "never finds its last word.",
                ],
                &[
                    "Keep the notebook anyway.",
                    "An unfinished page can return",
                    "from the quiet of the shelf.",
                ],
            ],
        },
        Book {
            title: "Old Lecture Notes",
            shelves: &["Наука"],
            tags: &["английский"],
            bookmark: None,
            note: None,
            last_page: 1,
            trash: true,
            pages: &[
                &[
                    "Old lecture notes on winter light.",
                    "The harbor example is still useful,",
                    "and so is the field diagram.",
                ],
                &[
                    "Question for the next class:",
                    "how does a journey change",
                    "when the evening comes early?",
                ],
            ],
        },
    ]
}

fn words() -> &'static [(&'static str, &'static str)] {
    &[
        ("apple", "яблоко"),
        ("atlas", "атлас"),
        ("book", "книга"),
        ("bread", "хлеб"),
        ("coast", "берег"),
        ("dictionary", "словарь"),
        ("emotion", "эмоция"),
        ("evening", "вечер"),
        ("field", "поле"),
        ("fir", "ёлка"),
        ("flower", "цветок"),
        ("glass", "стекло"),
        ("harbor", "гавань"),
        ("idea", "идея"),
        ("ink", "чернила"),
        ("journey", "путешествие"),
        ("kindness", "доброта"),
        ("lamp", "лампа"),
        ("language", "язык"),
        ("lantern", "фонарь"),
        ("library", "библиотека"),
        ("life", "жизнь"),
        ("morning", "утро"),
        ("night", "ночь"),
        ("notebook", "блокнот"),
        ("orchard", "сад"),
        ("page", "страница"),
        ("question", "вопрос"),
        ("quiet", "тишина"),
        ("rain", "дождь"),
        ("sea", "море"),
        ("sentence", "предложение"),
        ("shield", "щит"),
        ("speech", "речь"),
        ("tea", "чай"),
        ("travel", "поездка"),
        ("umbrella", "зонт"),
        ("voice", "голос"),
        ("whisper", "шёпот"),
        ("window", "окно"),
        ("winter", "зима"),
        ("xylophone", "ксилофон"),
        ("yogurt", "йогурт"),
        ("youth", "юность"),
        ("zone", "зона"),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open;
    use std::path::PathBuf;

    struct TempLibrary {
        root: PathBuf,
    }

    impl TempLibrary {
        fn new() -> Self {
            static NEXT: AtomicU64 = AtomicU64::new(0);
            let n = NEXT.fetch_add(1, Ordering::Relaxed);
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let root = std::env::temp_dir().join(format!("llr-seed-{nanos}-{n}"));
            fs::create_dir_all(root.join("documents")).unwrap();
            fs::create_dir_all(root.join("trash")).unwrap();
            Self { root }
        }

        fn documents(&self) -> PathBuf {
            self.root.join("documents")
        }

        fn trash(&self) -> PathBuf {
            self.root.join("trash")
        }

        fn database(&self) -> Connection {
            open(&self.root.join("library.db")).unwrap()
        }
    }

    impl Drop for TempLibrary {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn seeds_library_once_and_opens_as_pdf() {
        let library = TempLibrary::new();
        let conn = library.database();

        let first = seed_mock_library(&conn, &library.documents(), &library.trash()).unwrap();
        assert!(first.starts_with("Добавлено:"));

        let documents = db::list_documents(&conn).unwrap();
        let trash = db::list_trash(&conn).unwrap();
        assert_eq!(documents.len(), 9);
        assert_eq!(trash.len(), 2);
        assert_eq!(db::list_shelves(&conn).unwrap().len(), 3);
        assert_eq!(db::list_tags(&conn).unwrap().len(), 4);
        assert_eq!(
            db::list_dictionary_entries(&conn, "global", None, "")
                .unwrap()
                .len(),
            words().len()
        );

        let loose = documents
            .iter()
            .find(|document| document.title == "Untitled Margin")
            .unwrap();
        assert!(loose.shelf_ids.is_empty());
        assert!(loose.path.is_some());

        let orchard = documents
            .iter()
            .find(|document| document.title == "The Glass Orchard")
            .unwrap();
        assert_eq!(orchard.last_page, 2);
        assert_eq!(db::list_bookmarks(&conn, orchard.id).unwrap().len(), 1);

        let morning = documents
            .iter()
            .find(|document| document.title == "Morning in the Library")
            .unwrap();
        assert_eq!(db::list_notes(&conn, morning.id).unwrap().len(), 1);
        let bytes = fs::read(morning.path.as_deref().unwrap()).unwrap();
        assert!(bytes.starts_with(b"%PDF-"));
        assert!(bytes.windows(7).any(|window| window == b"library"));
        assert!(bytes.windows(5).any(|window| window == b"%%EOF"));
        let text = String::from_utf8_lossy(&bytes);
        let marker = text.rfind("startxref\n").unwrap();
        let xref_at: usize = text[marker + "startxref\n".len()..]
            .lines()
            .next()
            .unwrap()
            .trim()
            .parse()
            .unwrap();
        assert!(bytes[xref_at..].starts_with(b"xref\n"));
        assert!(text.contains("/Count 2"));

        let draft = trash
            .iter()
            .find(|document| document.title == "Unfinished Draft")
            .unwrap();
        let trashed_path = PathBuf::from(draft.path.clone().unwrap());
        assert!(trashed_path.starts_with(library.trash()));
        assert!(trashed_path.is_file());

        let second = seed_mock_library(&conn, &library.documents(), &library.trash()).unwrap();
        assert_eq!(second, "Примеры уже есть. Новые записи не добавлены.");
        assert_eq!(db::list_documents(&conn).unwrap().len(), 9);
        assert_eq!(db::list_trash(&conn).unwrap().len(), 2);
    }
}
