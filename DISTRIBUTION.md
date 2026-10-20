# Установка и выпуск NeuroBookShelf

## Для пользователя

На странице [GitHub Releases](https://github.com/WalkingFrozenFish/NeuroBookShelf/releases/latest) (блок Releases справа на главной странице репозитория) выбирайте файл под свою систему:

- Windows x64: `*-setup.exe`, установка для текущего пользователя.
- Windows x64 portable: `*-windows-x64-portable.zip`, распаковать в доступную для записи папку и открыть `NeuroBookShelf.exe`.
- macOS Apple Silicon (M1 и новее): `.dmg`, перенести NeuroBookShelf в Applications.

Python, OCR-библиотеки и движок перевода входят в поставку. Node.js, Rust, Git и pip пользователю не нужны.
Windows-комплект также содержит app-local библиотеки Visual C++ из Redistributable каталога сборочного Visual Studio.
Windows-установщик устанавливает WebView2 при его отсутствии; для этого нужен интернет.
При первом запуске окно «Модели» предлагает загрузить около 199 МБ данных для OCR и English → Russian.
Можно пропустить загрузку и читать PDF. Позже окно доступно кнопкой «Модели» в верхнем меню.
Загрузка проверяет SHA-256 файлов по закреплённому манифесту. После сбоя можно повторить; уже готовые компоненты сохраняются.
После установки моделей чтение, OCR и перевод работают локально.

## Данные и переносимость

Обычная установка сохраняет библиотеку и модели в каталоге данных приложения:

- Windows: `%APPDATA%/com.locallibrary.reader/`.
- macOS: `~/Library/Application Support/com.locallibrary.reader/`.

Обновление приложения не заменяет этот каталог.
Windows portable определяется файлом `portable.flag` рядом с EXE. Данные сохраняются в `user-data/` рядом с ним.
Переносить нужно всю папку, включая `runtime/`, `portable.flag` и `user-data/`.
При запуске portable копии пути PDF в базе перепривязываются к текущей папке библиотеки.
`LLR_DATA_DIR` позволяет явно выбрать корневой каталог данных.

## Автоматическая сборка

Workflow: `.github/workflows/desktop.yml`.

- Push в `master` или `codex/**`, а также pull request запускают проверки и сборки.
- Windows собирается на `windows-latest`, macOS ARM64 — на `macos-15`.
- В Actions → Desktop installers → выбранный запуск → Artifacts появляются установщики.
- Тег `v*` создаёт черновик GitHub Release с установщиками, portable ZIP и SHA256SUMS.
- После успешных проверок и сборок обеих платформ отдельный job проверяет наличие всех файлов и **публикует релиз**, отмечая его Latest. Если сборка не прошла, релиз остаётся черновиком.
- Обычные push не публикуют публичный релиз. Перед новым тегом обновите `RELEASE_NOTES.md` с описанием версии и файлами для скачивания.

Перед релизом версии в `package.json`, `src-tauri/tauri.conf.json` и `src-tauri/Cargo.toml` должны совпадать с тегом.
Пример выпуска текущей версии после слияния PR:

```bash
git checkout master
git pull --ff-only
git tag v0.1.0
git push origin v0.1.0
```

Actions собирает приватный CPython 3.11.14 из официальных Python standalone архивов.
Архитектуры и SHA-256 закреплены в `scripts/python-distributions.json`.
Зависимости ставятся в этот Python во время сборки. На компьютере пользователя установка пакетов не выполняется.
Проверенные версии транзитивных зависимостей закреплены в `python-worker/requirements.lock`.
`scripts/smoke_runtime.py` проверяет импорт библиотек, запуск JSON worker и чтение PDF.
`scripts/smoke_models.py` проверяет настоящую загрузку моделей, перевод и OCR на каждом сборочном runner.
Модели не входят в Git и установщик; источники, версии и SHA-256 находятся в `python-worker/model-manifest.json`.

## Локальная Windows-сборка

Нужны инструменты разработчика из SETUP.md и Python для сборочного скрипта:

```bash
npm ci
python scripts/build_runtime.py
npm run package:windows
python scripts/package_portable.py
```

Установщик находится в `src-tauri/target/release/bundle/nsis/`, portable ZIP — в `bundle/`.
Каталоги `bundle/` и `.distribution-cache/` не коммитятся.
Для macOS команды нужно выполнять на ARM64 Mac; форматы сборки — `app,dmg`.
Intel Mac пока не поддерживается: у закреплённого PaddlePaddle 3.2.0 нет нужного Intel macOS wheel.

## Подпись Windows и macOS

Без сертификата Windows сборка возможна, но система может показывать неизвестного издателя.
Текущий workflow не выполняет подпись Windows сертификатом издателя.

По умолчанию macOS-сборка получает ad-hoc подпись и предназначена для тестирования.
Она **не нотарифицирована**; это не равно беспрепятственной установке на чужом Mac.
Для обычного публичного распространения нужен Apple Developer ID и нотарификация.

Workflow поддерживает секреты GitHub Actions:

- `APPLE_CERTIFICATE`: сертификат Developer ID Application `.p12`, закодированный в base64.
- `APPLE_CERTIFICATE_PASSWORD`: пароль к `.p12`.
- `APPLE_SIGNING_IDENTITY`: имя Developer ID Application.
- `APPLE_ID`, `APPLE_PASSWORD` (app-specific), `APPLE_TEAM_ID`: учётные данные нотарификации.

Секреты вводятся только в Settings → Secrets and variables → Actions; в репозиторий их не добавляют.
Tauri Action импортирует сертификат перед упаковкой. Hook `scripts/sign_runtime.py` подписывает вложенные Mach-O файлы Python до включения в `.app`.
Первый подписанный macOS выпуск нужно проверить на чистом Mac; Windows-сборка этого не подтверждает.

## Проверки

```bash
npm test
npm run build
python -m unittest discover -s tests -p 'test_*.py'
cargo test --offline --manifest-path src-tauri/Cargo.toml --lib
```

Готовность установщиков определяется успешной сборкой и проверкой на соответствующей ОС.
Перед публикацией проверьте установку без системного Python, загрузку моделей, OCR, перевод и повторный запуск без сети.
