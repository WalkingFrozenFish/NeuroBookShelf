CREATE TABLE dictionaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL CHECK (kind IN ('global', 'document')),
    document_id INTEGER REFERENCES documents (id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (
        (kind = 'global' AND document_id IS NULL)
        OR (kind = 'document' AND document_id IS NOT NULL)
    )
);

CREATE UNIQUE INDEX dictionaries_one_global
ON dictionaries (kind)
WHERE kind = 'global';

CREATE UNIQUE INDEX dictionaries_one_document
ON dictionaries (document_id)
WHERE document_id IS NOT NULL;

INSERT INTO dictionaries (kind, document_id) VALUES ('global', NULL);

CREATE TABLE dictionary_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dictionary_id INTEGER NOT NULL REFERENCES dictionaries (id) ON DELETE CASCADE,
    source_text TEXT NOT NULL,
    translated_text TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
