# Сторонние компоненты NeuroBookShelf

Copyright исходников NeuroBookShelf: 2026 WalkingFrozenFish and contributors. Лицензия проекта — AGPL-3.0-only, см. [LICENSE](LICENSE). Она не заменяет лицензии сторонних компонентов.

## Основные зависимости

| Компонент | Объявленная лицензия | Источник |
| --- | --- | --- |
| React / React DOM | MIT | https://github.com/facebook/react |
| PDF.js | Apache-2.0 | https://github.com/mozilla/pdf.js |
| Tauri | MIT OR Apache-2.0 | https://github.com/tauri-apps/tauri |
| rusqlite | MIT | https://github.com/rusqlite/rusqlite |
| SQLite | Public domain; отдельные сведения включаются поставщиком rusqlite | https://sqlite.org/copyright.html |
| CPython | PSF-2.0 и уведомления включённых компонентов | https://docs.python.org/3/license.html |
| PyMuPDF / MuPDF | AGPL-3.0 либо отдельная коммерческая лицензия Artifex; в этом проекте используется открытая AGPL-сборка | https://pymupdf.io/licensing |
| PaddlePaddle / PaddleOCR | Apache-2.0 | https://github.com/PaddlePaddle/PaddleOCR |
| CTranslate2 | MIT | https://github.com/OpenNMT/CTranslate2 |
| SentencePiece | Apache-2.0 | https://github.com/google/sentencepiece |
| Windows Visual C++ Runtime | Условия перераспространения Microsoft Visual Studio | https://learn.microsoft.com/visualstudio/releases/2022/redistribution |

Эта таблица — обзор, а не полный список транзитивных зависимостей. `scripts/collect_licenses.py` сохраняет объявленные лицензии, версии и доступные тексты LICENSE / NOTICE / COPYING / COPYRIGHT из установленных Python-, npm- и Cargo-пакетов в `runtime/licenses/`. Собственная лицензия CPython также остаётся в `runtime/python/LICENSE.txt`. Лицензионные файлы колёс Python сохраняются в `site-packages/*.dist-info/`.

Инвентарь не является автоматическим юридическим заключением: при замене зависимости сопровождающий проверяет её условия, исходники, исключения и ограничения перераспространения. Неизвестные или отсутствующие сведения нельзя автоматически считать MIT или public domain.

## Модели

Для локального определения языков используется Lingua Language Detector 2.1.1 (Apache-2.0), включая поставляемые с библиотекой языковые данные. Лицензионные файлы сохраняются вместе с wheel в приватном Python и собираются `scripts/collect_licenses.py`. Веса переводчиков загружаются отдельно; лицензия Lingua не заменяет условия модельных пакетов.

### Argos English → Russian 1.9

Пакет: https://data.argosopentech.com/argospm/v1/translate-en_ru-1_9.argosmodel

Источник и SHA-256 закреплены в `python-worker/model-manifest.json`. Пакет создан Aleksey Kutashov; его README описывает данные OPUS, Wiktionary/Wiktextract и другие источники. Сопровождающий Argos указывает MIT/CC0 для модельных пакетов: https://github.com/argosopentech/argos-translate/issues/533. Это заявление поставщика, а не самостоятельная проверка прав на каждый обучающий корпус.

README модели также перечисляет корпусы с собственными условиями, включая research-only формулировки. Сохраняем исходный README и metadata рядом с моделью, а копию README — в `licenses/argos-en-ru-README.md`. Перед изменением модели или использованием в закрытом/коммерческом продукте нужна отдельная проверка этих условий; AGPL приложения не отменяет права на модель и обучающие данные.

### Дополнительные языковые пары Argos 1.9

В каталог добавлены Russian → English, French → English и English → French. URL, точный размер и SHA-256 каждого архива закреплены в `python-worker/model-manifest.json`; архивы скачаны и проверены при добавлении. Эти модели необязательны и загружаются только после выбора пользователя.

Исходные README и metadata каждого пакета сохранены в `licenses/argos-ru-en-*`, `licenses/argos-fr-en-*`, `licenses/argos-en-fr-*` и устанавливаются рядом с моделью. Французские пакеты ссылаются на OPUS-MT (Jörg Tiedemann и Santhosh Thottingal) и объявляют CC-BY 4.0 для исходных OPUS-моделей. Russian → English содержит отдельный список корпусов и условий в исходном README. Уведомления сохранены без замены лицензией приложения.

### PaddleOCR

PP-OCRv5_mobile_det и en_PP-OCRv5_mobile_rec скачиваются из официальных репозиториев PaddlePaddle. Их карточки объявляют Apache-2.0:

- https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_det
- https://huggingface.co/PaddlePaddle/en_PP-OCRv5_mobile_rec

Commit и SHA-256 каждого файла закреплены в манифесте. Текст Apache-2.0 и уведомления PaddleOCR включены в `licenses/`; сборка копирует их в runtime.

## Исходники и распространение

Исходники приложения, инструкции сборки, закреплённые зависимости и манифест моделей доступны в этом репозитории. Каждая новая версия выпускается из тега, который GitHub связывает с архивами исходников. При распространении изменённой версии соблюдайте AGPL, сохраняйте уведомления и предоставляйте соответствующие исходники своей версии.

Пользовательские PDF и их содержимое не входят в лицензию приложения. Импорт или перевод документа не предоставляет права на его дальнейшее распространение.
