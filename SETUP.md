# Окружение разработчика NeuroBookShelf

Инструкция для разработчика, который клонирует репозиторий и запускает development-версию локально.

Для установки готовой версии без инструментов разработчика и настройки автоматических релизов см. [DISTRIBUTION.md](DISTRIBUTION.md).

Описание продукта — в [README.md](README.md). Устройство приложения — в [ARCHITECTURE.md](ARCHITECTURE.md).

Проект проверялся на Windows 10. Команды ниже записаны для этого окружения: Git Bash, лаунчер `py` и npm. На другой ОС пути данных и выбор Python отличаются; системные зависимости Tauri для Linux и macOS в репозитории не зафиксированы.

# 1. Требования к системе

| Компонент | Версия | Зачем |
| --- | --- | --- |
| Git | не зафиксирована | Клонирование репозитория. Для работы приложения не нужен. |
| Node.js | 22, не ниже 22.12; `.nvmrc` и `package.json` | Сборка интерфейса Vite и запуск Tauri CLI. |
| npm | не зафиксирована. В репозитории `package-lock.json` с `lockfileVersion` 3 | Единственный используемый менеджер пакетов JavaScript. |
| Rust и Cargo | stable, минимальный профиль и компоненты rustfmt/clippy заданы в `rust-toolchain.toml`; зависимости закреплены в Cargo.lock | Сборка desktop-приложения Tauri. |
| Компилятор MSVC (Visual Studio Build Tools, рабочая нагрузка C++) | версия не зафиксирована | На Windows Rust собирает приложение линковщиком MSVC. |
| WebView2 Runtime | версия не зафиксирована | Окно Tauri на Windows показывает интерфейс через системный WebView2. На обновлённой Windows 10 он обычно уже установлен. |
| Python | 3.10, 3.11 или 3.12 | Worker читает PDF, распознаёт текст и переводит. Python 3.14 не подходит: у PaddlePaddle нет колеса для 3.14, это записано в `python-worker/requirements.txt`. |
| pip | версия не зафиксирована | Ставит зависимости из `requirements.txt`. |
| PyMuPDF, PaddlePaddle CPU, PaddleOCR, CTranslate2, SentencePiece | версии зафиксированы в `requirements.txt` | Обработка PDF, OCR и перевод. |
| Модель Argos Translate English→Russian 1.9 | файлы перечислены в `requirements.txt` | Локальный перевод. В pip её нет. |

Отдельно ставить не нужно:

- pnpm и Yarn: lock-файлов этих менеджеров нет;
- системный SQLite: `rusqlite` собирается с feature `bundled`;
- PostgreSQL, Docker, CUDA и GPU;
- отдельный сервер.

Первый запуск скачивает пакеты npm и crates Cargo. Для этого нужен интернет. Дальше приложение может работать без сети, если модели уже лежат на диске. Подробности — в разделе 6.

# 2. Клонирование репозитория

```bash
git clone https://github.com/WalkingFrozenFish/NeuroBookShelf.git
cd NeuroBookShelf
```

# 3. Установка frontend dependencies

Менеджер пакетов — npm.

```bash
npm ci
```

Команда ставит зависимости из `package-lock.json`.

# 4. Rust / Tauri setup

Проверка:

```bash
rustc --version
cargo --version
```

`rustc` должен понимать Rust edition 2024. Если команд нет, установите Rust через rustup и откройте новый терминал. На Windows при установке выберите toolchain MSVC, не GNU.

Зависимости Tauri уже указаны в `src-tauri/Cargo.toml`: Tauri 2, `tauri-plugin-dialog`, `rusqlite` с встроенным SQLite. Их версии зафиксированы в `src-tauri/Cargo.lock`. Отдельный `cargo install` не нужен: CLI Tauri ставится через npm-пакет `@tauri-apps/cli`.

Системные зависимости на Windows:

- WebView2 Runtime;
- Visual Studio Build Tools с компилятором C++.

Проверка, что окружение Tauri собралось:

```bash
npm run tauri -- --version
cargo check --manifest-path src-tauri/Cargo.toml
```

`cargo check` первый раз скачивает crates и компилирует приложение. Успешное завершение означает, что Rust, MSVC и зависимости Tauri доступны. Окно при этом не открывается.

# 5. Python environment

Манифест зависимостей — `python-worker/requirements.txt`. `pyproject.toml`, Poetry и uv в проекте нет.

Рекомендуемое окружение — virtual environment на Python 3.10. Приложение само его не активирует: оно запускает новый процесс и ищет интерпретатор отдельно. После создания окружения путь к нему нужно передать в `LLR_PYTHON`. Иначе на Windows будет выбран первый из `py -3.12`, `py -3.11`, `py -3.10`, `python`, `py -3`, в котором есть PyMuPDF.

```bash
py -3.10 -m venv .venv
```

Активация в Git Bash на Windows:

```bash
source .venv/Scripts/activate
```

Активация в cmd:

```bat
.venv\Scripts\activate.bat
```

Активация в PowerShell:

```powershell
.venv\Scripts\Activate.ps1
```

Активация на Linux и macOS, если окружение создано там:

```bash
source .venv/bin/activate
```

`paddlepaddle` нельзя ставить обычной строкой из `requirements.txt`: CPU-колесо берётся с отдельного индекса, как написано в комментарии файла. Порядок:

```bash
python -m pip install pymupdf==1.28.2
python -m pip install paddlepaddle==3.2.0 -i https://www.paddlepaddle.org.cn/packages/stable/cpu/
python -m pip install paddleocr==3.7.0 ctranslate2==4.6.0 sentencepiece==0.2.1
```

Проверка импортов:

```bash
python -c "import pymupdf, paddleocr, ctranslate2, sentencepiece"
```

# 6. ML / OCR / translation dependencies

## PyMuPDF

Пакет `pymupdf==1.28.2`. Читает PDF, текстовый слой и рисует область для OCR в памяти процесса. Отдельные файлы и модели не скачивает.

## OCR и PaddleOCR

Пакеты `paddlepaddle==3.2.0` и `paddleocr==3.7.0`. В `requirements.txt` указана CPU-сборка PaddlePaddle. Код создаёт `PaddleOCR(lang="en")` и не передаёт устройство CUDA.

Каталог моделей OCR приложение не задаёт. При первом распознавании PaddleOCR может скачать свои модели в собственный кэш. Путь и размер этого кэша в проекте не зафиксированы. Для такой первой загрузки нужен интернет. Повторный вызов в том же процессе worker модель заново не создаёт: движок хранится в переменной процесса.

Изображения страниц на диск не пишутся.

## Перевод

Пакеты `ctranslate2==4.6.0` и `sentencepiece==0.2.1`. Переводчик создаётся так: `ctranslate2.Translator(..., device="cpu")`. GPU не используется.

Модель при переводе не скачивается. Её нужно положить вручную в `python-worker/models/en-ru`:

- `model.bin`
- `config.json`
- `shared_vocabulary.json`
- `sentencepiece.model`

Источник записан в `requirements.txt`: пакет Argos Translate English→Russian 1.9, `https://data.argosopentech.com/argospm/v1/translate-en_ru-1_9.argosmodel`. Скачивание выполняется один раз и отдельно от запуска приложения. В архиве должны оказаться четыре файла выше.

В подготовленной рабочей копии `model.bin` занимает около 204 МБ, весь каталог `en-ru` — около 207 МБ. Это размер этих файлов, а не значение из кода.

Другой каталог можно указать переменной `LLR_TRANSLATION_MODEL`. Если `model.bin` или `sentencepiece.model` нет, перевод возвращает `MODEL_MISSING`.

## Offline и ускорители

Интернет нужен для npm, Cargo, pip, однократного скачивания модели перевода и первой загрузки моделей PaddleOCR, если их ещё нет в кэше PaddleOCR.

После этого чтение PDF, OCR и перевод выполняются локально. Код не требует CUDA и не включает GPU. CPU достаточен.

# 7. Локальные данные приложения

Каталог создаёт Tauri через `app_data_dir()` для идентификатора `com.locallibrary.reader`.

На Windows, где это проверено:

`%APPDATA%\com.locallibrary.reader\`

Обычно это `C:\Users\<имя>\AppData\Roaming\com.locallibrary.reader\`.

Тот же идентификатор на других ОС резолвится правилами Tauri. Эти пути в репозитории не проверялись:

- Linux: `$XDG_DATA_HOME/com.locallibrary.reader` или `~/.local/share/com.locallibrary.reader`;
- macOS: `~/Library/Application Support/com.locallibrary.reader`.

Содержимое:

```
library/documents/    копии импортированных PDF
library/trash/        копии, перемещённые в корзину
data/library.db       SQLite
```

В базе хранятся документы, полки, теги, закладки, заметки, области перевода, версии перевода и словари. Байты PDF в базу не записываются.

В интерфейсе библиотеки строка «База:» показывает фактический путь к `library.db`.

Чего в этом каталоге нет:

- миниатюр и обложек: миниатюры рисует PDF.js в окне читалки и на диск не сохраняет;
- кэша OCR и кэша переводов: результат перевода хранится в SQLite, картинка для OCR остаётся в памяти Python;
- моделей перевода: они лежат в `python-worker/models/en-ru` внутри исходников, каталог исключён из Git;
- моделей OCR: их расположение выбирает PaddleOCR, в коде проекта путь не задан.

Исходный PDF, выбранный в диалоге импорта, не изменяется и не удаляется. Удаляется только копия из корзины и только командой окончательного удаления.

# 8. Первый запуск

Команды из корня репозитория, по порядку.

```bash
git clone https://github.com/WalkingFrozenFish/NeuroBookShelf.git
cd NeuroBookShelf
npm ci
py -3.10 -m venv .venv
source .venv/Scripts/activate
python -m pip install pymupdf==1.28.2
python -m pip install paddlepaddle==3.2.0 -i https://www.paddlepaddle.org.cn/packages/stable/cpu/
python -m pip install paddleocr==3.7.0 ctranslate2==4.6.0 sentencepiece==0.2.1
```

Затем вручную положите четыре файла модели в `python-worker/models/en-ru`. Без них библиотека и чтение PDF работают, перевод — нет.

Проверка worker:

```bash
printf '%s\n' '{"command":"ping"}' | python -u python-worker/worker.py
```

Ожидаемый ответ: `{"success": true, "result": "pong"}`.

Запуск приложения. `LLR_PYTHON` нужен, потому что активированное окружение не подхватывается поиском интерпретатора:

```bash
export LLR_PYTHON="$(pwd)/.venv/Scripts/python.exe"
npm run tauri dev
```

На Linux и macOS интерпретатор окружения — `.venv/bin/python`, а активация — `source .venv/bin/activate`.

Порт `1420` должен быть свободен: Vite в `vite.config.ts` использует `strictPort: true`.

# 9. Development commands

| Команда | Назначение |
| --- | --- |
| `npm run dev` | Только Vite на `http://localhost:1420`. Окна Tauri, базы и Python нет. |
| `npm run tauri dev` | Development-приложение: Vite, окно Tauri, SQLite и Python worker. |
| `npm run build` | Проверка TypeScript и сборка интерфейса в `dist/`. |
| `npm run preview` | Локальный просмотр уже собранного `dist/`. Это не desktop-приложение. |
| `npx tsc --noEmit` | Отдельная проверка TypeScript. Отдельного npm-скрипта для неё нет; `npm run build` тоже запускает `tsc`. |
| `npm run tauri -- --version` | Проверка CLI Tauri. |
| `cargo check --manifest-path src-tauri/Cargo.toml` | Проверка компиляции Rust без запуска окна. |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib db::tests` | Тесты SQLite. Базу приложения не используют. |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib worker::tests` | Тесты протокола worker, PDF, OCR и перевода. Часть тестов загружает PaddleOCR и модель и выполняется долго. |
| `python -m py_compile python-worker/worker.py` | Проверка синтаксиса worker. |
| `printf '%s\n' '{"command":"ping"}' \| python -u python-worker/worker.py` | Короткий ответ worker. |

Команды lint в проекте нет: ESLint и других скриптов проверки стиля в `package.json` нет. Набора pytest тоже нет.

# 10. Production build

Команда:

```bash
npm run tauri build
```

Она сначала выполняет `npm run build`, затем собирает Rust в release. Исполняемый файл появляется в `src-tauri/target/release/`. Установщики Tauri, если шаг упаковки дошёл до конца, появляются в `src-tauri/target/release/bundle/`. В `src-tauri/tauri.conf.json` указано `"targets": "all"`. На Windows для MSI и NSIS могут понадобиться дополнительные инструменты упаковки; их состав в репозитории не зафиксирован.

Эта сборка не является переносимым приложением:

- Python runtime в пакет не входит;
- зависимости pip не входят;
- модель перевода не входит и каталог `python-worker/models/` не копируется сборкой;
- путь к `python-worker/worker.py` вшивается на этапе компиляции от каталога `src-tauri`. Собранный файл по-прежнему ищет worker в исходном дереве, из которого его собрали.

Для запуска собранного файла на этой машине по-прежнему нужны исходники `python-worker`, установленный Python с зависимостями и модель перевода.

# 11. Git

Минимальный цикл после клонирования:

```bash
git pull
git checkout -b feature/<short-name>
git add .
git commit -m "Why this change is needed"
git push -u origin HEAD
```

Перед `git add .` посмотрите `git status`. Не добавляйте пользовательские PDF, базу, `.venv` и модели.

Корневой `.gitignore` исключает `node_modules`, `dist`, `__pycache__`, `.venv`, `venv`, `.env`, `python-worker/models/` и `*.pdf`. Файл `src-tauri/.gitignore` исключает `target/` и сгенерированные схемы Tauri. Временных файлов OCR проект не создаёт, отдельного каталога кэша в репозитории нет.

Рекомендации расширений редактора лежат в `.vscode/extensions.json`. Остальное содержимое `.vscode/` игнорируется.

# 12. Что должно находиться в Git

Должно храниться:

- исходники `src/`, `src-tauri/src/` и `python-worker/worker.py`;
- миграции `src-tauri/migrations/`;
- `package.json` и `package-lock.json`;
- `src-tauri/Cargo.toml` и `src-tauri/Cargo.lock`;
- `python-worker/requirements.txt`;
- `vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `src-tauri/tauri.conf.json`, `src-tauri/build.rs`;
- иконки из `src-tauri/icons/`;
- `README.md`, `ARCHITECTURE.md`, `ROADMAP.md`, `CURSOR_RULES.md`, `SETUP.md`;
- `.vscode/extensions.json`.

Не должно храниться:

- `node_modules` и `dist`;
- `src-tauri/target`;
- `.venv`;
- `__pycache__`;
- `data/library.db` и каталоги `library/documents`, `library/trash` пользовательской библиотеки;
- скачанная модель в `python-worker/models/`;
- импортированные PDF.

Пустые `.gitkeep` не нужны: рабочие каталоги данных создаёт приложение, каталог модели создаётся при её установке.

# 13. Environment variables / config

Файла `.env` проект не читает. `.env.example` нет. Если такой файл всё же создать локально, корневой `.gitignore` его исключает.

| Переменная | Обязательна | Назначение | Пример |
| --- | --- | --- | --- |
| `LLR_PYTHON` | нет | Полный путь к интерпретатору, в котором установлены зависимости worker. Если пусто, приложение перебирает системные команды. | `C:\Users\dev\proj\.venv\Scripts\python.exe` |
| `LLR_TRANSLATION_MODEL` | нет | Каталог модели вместо `python-worker/models/en-ru`. | `D:\models\en-ru` |
| `TAURI_DEV_HOST` | нет | Читается `vite.config.ts`. Tauri может задать её для удалённого dev-сервера. Для обычного локального запуска не нужна. | `192.168.1.10` |

При запуске worker процесс сам получает `PYTHONUNBUFFERED=1`, `PYTHONIOENCODING=utf-8` и `KMP_DUPLICATE_LIB_OK=TRUE`. Задавать их вручную не нужно. Worker также выставляет параметры журналов Paddle, чтобы они не попадали в JSON-протокол.

# 14. Проверка установки

1. `npm run tauri dev` открывает окно «Local Library Reader».
2. Раздел «Библиотека» показывает строку «База:» с путём к `library.db`.
3. Импорт PDF через интерфейс создаёт карточку. Исходный файл остаётся на своём месте.
4. «Читать» открывает страницу, миниатюры и переход по страницам.
5. Команда `ping` из раздела 8 возвращает `pong`.
6. Выделение области на скане без текстового слоя и команда распознавания возвращают текст. Первый запуск OCR может занять заметное время.
7. Перевод фразы `Hello` даёт русский текст и сохраняется в правой панели. Повторное открытие той же страницы модель заново не запускает.

Если модели перевода ещё нет, пункты 1–4 всё равно должны выполняться. Перевод покажет сообщение о недоступной модели.

# 15. Troubleshooting

**`npm install` завершается с ошибкой сети или прав.** Запустите команду из корня репозитория, где лежат `package.json` и `package-lock.json`. Другой менеджер пакетов не используйте.

**`rustc` или `cargo` не найдены.** Установите Rust через rustup, toolchain MSVC, и откройте терминал заново. `edition = "2024"` не соберётся старым компилятором.

**`npm run tauri dev` не открывает окно.** Проверьте вывод `cargo check --manifest-path src-tauri/Cargo.toml`. На Windows без MSVC или WebView2 сборка Tauri останавливается до окна. Если занят порт 1420, Vite остановится из-за `strictPort`.

**«Python не найден» или «Не удалось запустить Python worker».** Установите Python 3.10–3.12 и задайте `LLR_PYTHON` на `python.exe` того окружения, куда поставлены зависимости. Активации `.venv` недостаточно.

**`PADDLEOCR_MISSING` или `MODEL_UNAVAILABLE`.** В выбранном интерпретаторе нет пакета. Повторите команды pip из раздела 5 именно для этого интерпретатора: `python -c "import sys; print(sys.executable)"`.

**OCR долго висит или не может скачать модель.** Первое создание `PaddleOCR` может обращаться в сеть. Проверьте интернет и что установлена CPU-сборка `paddlepaddle==3.2.0`, а не пакет для Python 3.14.

**«Не удалось открыть PDF. Файл повреждён или имеет неподдерживаемый формат.»** Читалка получила файл, который PDF.js не открыл. Импорт другого файла отвечает «Можно импортировать только PDF» или «Файл не является PDF».

**`MODEL_MISSING`.** В каталоге модели нет `model.bin` или `sentencepiece.model`. Положите файлы в `python-worker/models/en-ru` либо укажите `LLR_TRANSLATION_MODEL`.

**«Не удалось открыть SQLite» или ошибка миграции при старте.** База лежит по пути из строки «База:». Сообщение миграции — текст SQLite, отдельного кода в интерфейсе нет. Не удаляйте файл, пока не скопируете каталог данных. Приложение применяет миграции из `src-tauri/migrations` само, ручной команды миграции нет.

**«Python worker завершился без ответа».** Процесс Python закрылся, не прислав JSON. Часто это отсутствующая зависимость или падение при первой загрузке PaddleOCR. Следующий вызов запускает worker заново.

# 16. Clean reset

Сначала закройте приложение.

Сброс удаляет development-библиотеку целиком:

- копии PDF в `library/documents`;
- файлы корзины в `library/trash`;
- `data/library.db`: карточки, полки, теги, закладки, заметки, переводы и словари.

Исходные PDF вне этого каталога, `.venv`, `python-worker/models` и кэш PaddleOCR эта операция не трогает.

На Windows удалите каталог:

`%APPDATA%\com.locallibrary.reader`

Следующий запуск создаст пустую библиотеку. Восстановить удалённые заметки и переводы из репозитория нельзя: их там нет.

# 17. Backup

Чтобы сохранить библиотеку, скопируйте весь каталог данных приложения:

`%APPDATA%\com.locallibrary.reader`

Внутри него:

- `library/documents` — копии PDF;
- `library/trash` — копии, которые лежат в корзине;
- `data/library.db` — все связанные записи.

Копируйте каталог при закрытом приложении, иначе файл SQLite может быть занят.

Модель перевода хранится отдельно, в `python-worker/models/en-ru`. Для переноса перевода на другую машину скопируйте и её. Кэш моделей OCR в каталог приложения не входит.
