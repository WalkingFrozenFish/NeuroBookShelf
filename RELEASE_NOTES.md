# NeuroBookShelf 0.2.0

[Сайт / Website](https://walkingfrozenfish.github.io/NeuroBookShelf/) · [Руководство](https://github.com/WalkingFrozenFish/NeuroBookShelf/blob/v0.2.0/docs/GUIDE.md) · [User guide](https://github.com/WalkingFrozenFish/NeuroBookShelf/blob/v0.2.0/docs/GUIDE.en.md)

## Что нового

- Русский/English для всего интерфейса, переключение без перезапуска в «Настройки → Общие».
- Каталог моделей перевода: English ↔ Russian, French ↔ English и дополнительные пары из официального каталога Argos. Выбор исходного/целевого языка, локальное автоопределение и подбор установленных моделей, включая перевод через промежуточный язык.
- Отмена и повтор загрузки моделей; уже готовые файлы сохраняются. Новые задания фоновой очереди запоминают выбранное направление.
- Настройки разделены на «Общие», «Данные», «OCR и перевод», «Оформление». Корзина находится в левой панели библиотеки над настройками.
- Свой основной цвет через палитру, светлый/тёмный интерфейс и отдельный режим отображения PDF. Улучшены карточки, подсказки пустых экранов и фильтры моделей. Приложение открывается развёрнутым.
- Двуязычные README, руководство, лендинг и короткие демонстрации.

## Скачать и установить

- **Windows x64:** `NeuroBookShelf_0.2.0_x64-setup.exe` — установка для текущего пользователя.
- **Windows portable:** `NeuroBookShelf-0.2.0-windows-x64-portable.zip` — распакуйте в доступную для записи папку и откройте `NeuroBookShelf.exe`. Данные находятся в `user-data/`; переносите всю папку целиком.
- **macOS Apple Silicon (M1 и новее):** `NeuroBookShelf_0.2.0_aarch64.dmg` — перенесите приложение в Applications. Intel Mac пока не поддерживается.

Python и библиотеки включены. Windows-установщик при необходимости скачает WebView2. PDF можно читать сразу. Модели доступны в «Настройки → OCR и перевод»: OCR и базовая пара English → Russian требуют около 199 МиБ, дополнительные пары загружаются отдельно. После загрузки обработка выполняется локально; PDF не отправляются в облако.

## Обновление и ограничения

Каталог библиотеки и прежние настройки сохраняются; миграции базы нет. Перед обновлением закройте приложение и сохраните резервную копию каталога данных, а при отдельном расположении базы — также её файла. При обновлении portable сохраните `user-data/` и `portable.flag`.

OCR распознаёт **английский**. Другие языки переводятся из существующего текстового слоя PDF. Очередь не возобновляется после перезапуска; готовые переводы сохраняются. Качество распознавания и перевода зависит от документа.

Windows-сборка пока без сертификата издателя; macOS использует ad-hoc подпись без нотарификации. Система может предупредить или заблокировать первый запуск. [Инструкция по установке](https://github.com/WalkingFrozenFish/NeuroBookShelf/blob/v0.2.0/DISTRIBUTION.md).

## English

NeuroBookShelf 0.2.0 adds a Russian/English interface, downloadable English ↔ Russian and French ↔ English translation pairs, the official Argos catalog, source/target selection and local language detection. Installed direct or pivot routes are chosen automatically. Downloads can be cancelled and retried; queued jobs keep their selected direction.

Settings now have four tabs: General, Data, OCR & translation and Appearance. Trash is in the library sidebar. Choose a custom accent hue, use improved library cards and empty states, and browse bilingual documentation and walkthroughs.

Download the Windows x64 installer, Windows portable ZIP or macOS Apple Silicon DMG listed above. Python is included; models are downloaded separately through **Settings → OCR & translation**. Reading works without models. Once installed, OCR and translation run offline without uploading documents.

Existing library data and preferences are retained, with no database migration. Close the app and back up its data directory and any separately stored database before updating. Preserve `user-data/` and `portable.flag` when updating a portable installation.

OCR currently supports **English only**; other languages require a PDF text layer. Background queues do not resume after restart; saved translations remain. Windows builds have no publisher certificate, and macOS uses an ad-hoc signature without notarization. See the [installation guide](https://github.com/WalkingFrozenFish/NeuroBookShelf/blob/v0.2.0/DISTRIBUTION.en.md).

## Проверки / Validation

The release workflow requires checks and Windows/macOS installer builds, bundled Python/model download smoke tests, real OCR/translation, package checks and SHA-256 inventories before publishing. Download checksums are provided in `SHA256SUMS-*.txt`.
