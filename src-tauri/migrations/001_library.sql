CREATE TABLE documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE shelves (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX shelves_name_nocase ON shelves (name COLLATE NOCASE);

CREATE TABLE tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX tags_name_nocase ON tags (name COLLATE NOCASE);

CREATE TABLE document_shelves (
    document_id INTEGER NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
    shelf_id INTEGER NOT NULL REFERENCES shelves (id) ON DELETE CASCADE,
    PRIMARY KEY (document_id, shelf_id)
);

CREATE TABLE document_tags (
    document_id INTEGER NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
    PRIMARY KEY (document_id, tag_id)
);
