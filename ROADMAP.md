# Roadmap

Работа выполняется строго по этапам.

После завершения этапа остановиться.

Не начинать следующий этап автоматически.

Статус: Stage 1–18 завершены.

---

# Stage 1 — Project skeleton

Цель:

Создать минимальный desktop-проект.

Сделать:

- React
- TypeScript
- Tauri
- базовую структуру каталогов
- базовую навигацию
- пустые страницы:
  - Library
  - Reader
  - Trash
- базовый layout

Не делать:

- SQLite
- PDF viewer
- OCR
- перевод
- Python worker

Definition of Done:

Приложение запускается как desktop application и можно переключаться между страницами.

---

# Stage 2 — SQLite and library model

Добавить:

- SQLite
- documents
- shelves
- tags
- связи между ними

Сделать CRUD для:

- документов
- полок
- тегов

Пока не работать с реальными PDF.

Можно использовать тестовые записи.

---

# Stage 3 — PDF import

Добавить:

- выбор PDF через системный dialog;
- копирование PDF в library/documents;
- сохранение metadata в SQLite;
- отображение документов в Library.

При импорте сохранить:

- original filename
- internal filename
- path
- file size
- hash
- createdAt

---

# Stage 4 — Shelves and tags

Добавить:

- создание полок;
- drag and drop документов между полками;
- назначение тегов;
- фильтрацию;
- поиск.

Полки являются виртуальными.

Перемещение между полками НЕ должно перемещать физический PDF.

---

# Stage 5 — Trash and export

Добавить:

- удаление документа в trash;
- восстановление;
- физическое удаление только отдельной командой;
- экспорт PDF в выбранную пользователем директорию.

---

# Stage 6 — Basic PDF reader

Добавить PDF.js.

Reader:

- список миниатюр слева;
- текущая страница по центру;
- правая панель;
- навигация по страницам;
- zoom;
- fit width;
- fit page.

Сохранять последнюю открытую страницу.

---

# Stage 7 — Bookmarks and notes

Добавить:

- bookmarks;
- note на документ;
- note на страницу;
- вкладку Notes справа.

---

# Stage 8 — Python worker

Создать минимальный Python worker.

На данном этапе только:

- запуск из Tauri;
- получение команды;
- возврат JSON.

Не добавлять OCR.

---

# Stage 9 — PDF text extraction

Добавить PyMuPDF.

Реализовать:

- проверку текстового слоя;
- получение текста страницы;
- получение координат текстовых блоков.

Показывать результат в debug UI.

---

# Stage 10 — Area selection

Добавить поверх PDF selection layer.

Пользователь может мышкой выделить прямоугольную область.

Сохранять относительные координаты.

Пока не переводить.

---

# Stage 11 — OCR

Добавить PaddleOCR.

Если выбранная область не содержит пригодного текстового слоя:

- render area;
- OCR;
- вернуть текст.

Добавить возможность вручную исправить OCR result.

---

# Stage 12 — Local translation

Добавить первый локальный translation engine.

Интерфейс должен быть абстрактным:

Translator.translate(text)

Не связывать UI напрямую с конкретной моделью.

---

# Stage 13 — Translation blocks

Добавить TranslationBlock.

После перевода сохранять:

- область;
- OCR text;
- translation.

Показывать список переводов справа.

Клик по переводу должен подсвечивать исходную область.

---

# Stage 14 — Translation overlay

Добавить popup поверх страницы.

Popup:

- draggable;
- resizable;
- show/hide;
- position persisted.

---

# Stage 15 — Translation versions

Добавить:

- retranslate;
- history;
- выбор активной версии;
- редактирование перевода.

---

# Stage 16 — Full page translation

Добавить команду:

Translate page

Она должна:

- определить текстовые блоки;
- получить текст;
- перевести блоки;
- создать TranslationBlocks.

---

# Stage 17 — Dictionary

Добавить:

- dictionary per document;
- global dictionary;
- dictionary tab;
- поиск;
- ручное добавление слов;
- редактирование.

---

# Stage 18 — Cleanup

После реализации основных функций:

- удалить временный debug UI;
- проверить структуру проекта;
- проверить ошибки;
- уменьшить duplication;
- обновить README.

Не проводить крупный рефакторинг без необходимости.