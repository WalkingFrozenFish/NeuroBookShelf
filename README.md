# NeuroBookShelf

Локальная PDF-библиотека с OCR и переводом с английского на русский. Храните книги на полках, ищите по тексту, оставляйте заметки и переводите страницы без облачных сервисов.

[![Release](https://img.shields.io/github/v/release/WalkingFrozenFish/NeuroBookShelf)](https://github.com/WalkingFrozenFish/NeuroBookShelf/releases/latest)
[![Desktop CI](https://github.com/WalkingFrozenFish/NeuroBookShelf/actions/workflows/desktop.yml/badge.svg?branch=master)](https://github.com/WalkingFrozenFish/NeuroBookShelf/actions/workflows/desktop.yml)
[![License: AGPL v3](https://img.shields.io/badge/license-AGPLv3-blue.svg)](LICENSE)

**[Скачать приложение](https://github.com/WalkingFrozenFish/NeuroBookShelf/releases/latest)** · [Установка](DISTRIBUTION.md) · [Сообщить об ошибке](https://github.com/WalkingFrozenFish/NeuroBookShelf/issues/new/choose) · [История версий](CHANGELOG.md)

## Установка

| Платформа | Файл в Release | Как запустить |
| --- | --- | --- |
| Windows x64 | `*-setup.exe` | Открыть установщик |
| Windows x64 portable | `*-windows-x64-portable.zip` | Распаковать и открыть `NeuroBookShelf.exe` |
| macOS Apple Silicon, M1 и новее | `*_aarch64.dmg` | Перенести приложение в Applications |

Python и библиотеки уже включены. Git, Node.js, Rust и ручная установка пакетов пользователю не нужны. Windows-установщик при необходимости скачает WebView2.

При первом запуске откройте **«Модели»** и загрузите около 199 МиБ для OCR и перевода. Загрузку можно пропустить и сразу читать PDF. После установки моделей чтение, распознавание и перевод работают локально без сети. PDF не отправляются в облако.

Windows-сборка пока без сертификата издателя, а macOS использует тестовую ad-hoc подпись без нотарификации: система может предупреждать или блокировать первый запуск. Intel Mac и готовые Linux-пакеты пока не поддерживаются. Подробности — в [инструкции по установке](DISTRIBUTION.md).

## Возможности

- **Библиотека:** импорт PDF с сохранением копии, полки, теги, поиск, экспорт, корзина и восстановление.
- **Читалка:** миниатюры, масштаб, запоминание позиции, оглавление PDF, выделение и копирование текста, поиск по книге через Ctrl+F.
- **Заметки:** закладки и заметки документа или страницы, словарь книги и общий словарь.
- **Перевод:** выделенная область или целая страница, текстовый слой PDF или локальный OCR, версии перевода и редактируемые карточки поверх страницы.
- **Фоновая очередь:** перевод диапазона страниц, прогресс, отмена и повтор ошибок; очередь продолжает работать при переходах между книгами.
- **Переносимость:** portable хранит библиотеку и модели рядом с приложением; всю папку можно перенести на другой компьютер.

Поддерживается перевод **English → Russian**, OCR настроен на английский. Словарь служит ручной шпаргалкой и не изменяет результат модели.

## Данные и приватность

Обычная установка хранит PDF, SQLite и модели в каталоге данных приложения:

- Windows: `%APPDATA%/com.locallibrary.reader/`.
- macOS: `~/Library/Application Support/com.locallibrary.reader/`.
- Windows portable: `user-data/` рядом с EXE.

Импорт копирует документ и не меняет оригинал. Обновление приложения сохраняет каталог библиотеки. Для резервной копии закройте приложение и скопируйте весь каталог данных. Для переноса portable копируйте всю распакованную папку, включая `runtime/`, `portable.flag` и `user-data/`.

## Ограничения

Проект находится на ранней стадии, текущая ветка версий — 0.x.

- Читаются только PDF. EPUB, MOBI и комиксы пока не поддерживаются.
- Поиск и выделение используют существующий текстовый слой; OCR-индексации сканов пока нет.
- Фоновая очередь не восстанавливается после закрытия приложения. Сохранённые переводы остаются; повторная постановка пропускает готовые области.
- Качество OCR и перевода зависит от документа. Сложная вёрстка, таблицы, несколько колонок и некачественные сканы могут обрабатываться неточно.
- Страница с частичным текстовым слоем не дополняется OCR автоматически. Словарь не передаётся переводчику.

## Разработка

Стек: React 19, TypeScript, Vite, Tauri 2 / Rust, SQLite, PDF.js и Python worker с PyMuPDF, PaddleOCR, CTranslate2 и SentencePiece.

Для сборки нужны Node.js 22, Rust stable, системные зависимости Tauri и development Python 3.10–3.12. Пошаговая настройка — в [SETUP.md](SETUP.md).

```bash
git clone https://github.com/WalkingFrozenFish/NeuroBookShelf.git
cd NeuroBookShelf
npm ci
npm run tauri dev
```

Рабочий процесс: **ветка → PR → зелёный CI → squash merge → проверка основной ветки**. Публичный Release запускается отдельно тегом версии. Основная ветка — `master`, workflow также поддерживает `main`.

Инструкции для изменений и проверок: [CONTRIBUTING.md](CONTRIBUTING.md). Детали веток, CI и релизов: [docs/WORKFLOW.md](docs/WORKFLOW.md).

## Документация

| Документ | Содержание |
| --- | --- |
| [DISTRIBUTION.md](DISTRIBUTION.md) | Установка, portable, модели, сборка и подпись |
| [SETUP.md](SETUP.md) | Окружение разработчика и запуск |
| [OVERVIEW.md](OVERVIEW.md) | Карта экранов и поток запроса до базы |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Техническое устройство |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Изменения, PR и проверки |
| [docs/WORKFLOW.md](docs/WORKFLOW.md) | Ветки, merge, CI и выпуск версии |
| [CHANGELOG.md](CHANGELOG.md) | История изменений |
| [ROADMAP.md](ROADMAP.md) | Направления развития |
| [SUPPORT.md](SUPPORT.md) / [SECURITY.md](SECURITY.md) | Помощь и сообщения об уязвимостях |

## Лицензия

Исходники NeuroBookShelf распространяются под [GNU AGPL v3](LICENSE), SPDX: `AGPL-3.0-only`. Использование, изменения и распространение разрешены на условиях этой лицензии; при распространении сохраняйте уведомления и предоставляйте соответствующие исходники. Гарантии не предоставляются.

Библиотеки, Python и модели сохраняют собственные лицензии. Источники и уведомления перечислены в [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), а сборка включает доступные тексты лицензий и инвентарь зависимостей в `runtime/licenses/`.
