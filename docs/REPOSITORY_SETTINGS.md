# Настройки GitHub

Состояние аудита на 20 октября 2026 года: основная ветка `master`, описание и темы отсутствовали, ветка не была защищена. Публичный релиз `v0.1.0` опубликован. PR #1 содержит подготовленные изменения и ещё не объединён.

Настройки ниже применены с разрешения владельца и проверены через GitHub API 20 октября 2026 года. Основная ветка защищена, squash merge и очистка веток включены, приватные отчёты об уязвимостях включены.

## About

- Description: `Offline PDF library with local OCR, English-to-Russian translation, notes and portable desktop builds.`
- Website: `https://github.com/WalkingFrozenFish/NeuroBookShelf/releases/latest`.
- Topics: `pdf-reader`, `tauri`, `react`, `rust`, `python`, `ocr`, `offline`, `translation`, `desktop-app`, `windows`, `macos`, `portable`.

## Pull Requests

- Allow squash merging: включено; заголовок PR и его описание используются для сообщения squash-коммита.
- Merge commits и rebase merging: выключены, чтобы у проекта был один понятный способ merge.
- Automatically delete head branches: включено.
- Always suggest updating pull request branches: включено.
- Auto-merge можно разрешить, но он не включается для конкретного PR автоматически.

## Защита `master`

- Require a pull request before merging: включено.
- Required status check: `CI`, с требованием актуальности относительно основной ветки.
- Require conversation resolution: включено.
- Require linear history: включено.
- Force push и удаление: запрещены.
- Правила распространяются и на администратора.
- Required approving reviews: `0`, пока сопровождающий один. CODEOWNERS остаётся подсказкой о владельце кода, а не блокировкой собственного PR.

Политика не переименовывает ветку и не выполняет merge PR. Если основная ветка позже станет `main`, перенесите правило защиты на неё; workflow уже поддерживает оба имени.

## Безопасность и обслуживание

- Private vulnerability reporting: включено; ссылка конфиденциального отчёта из SECURITY.md доступна.
- Issues: включены; формы хранятся в `.github/ISSUE_TEMPLATE/`.
- Dependabot: конфигурация `.github/dependabot.yml` начнёт работать после попадания в основную ветку.
- README, шаблоны Issues/PR, CODEOWNERS и прочие community-файлы появятся на главной странице после merge PR #1. Файлы только в рабочей ветке не меняют главную страницу основной ветки.
