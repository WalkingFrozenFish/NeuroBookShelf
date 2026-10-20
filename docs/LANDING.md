# Двуязычный лендинг GitHub Pages

Исходники — `site/index.html` (русский), `site/en/index.html` (английский), общий `site/style.css` и `site/assets/`. Переключатель RU/EN использует обычные ссылки и работает без JavaScript. Обе страницы содержат title, description, canonical и hreflang; robots.txt и sitemap.xml включены.

Лендинг честно разделяет опубликованную 0.1.0 и возможности следующего выпуска. После нового Release обновляйте обе страницы вместе с README.

## Публикация

1. В GitHub откройте Settings → Pages → Build and deployment → Source → **GitHub Actions**. Для этого нужны права администратора репозитория.
2. Объедините изменения через PR в `master` или `main`. Workflow `.github/workflows/pages.yml` публикует только каталог `site/` и не выкладывает desktop-приложение или пользовательские данные.
3. Если Pages включили после merge, запустите **Actions → Landing page → Run workflow**.
4. После успешного deploy адрес: `https://walkingfrozenfish.github.io/NeuroBookShelf/`, английская версия — `/en/`.
5. После подтверждённой публикации укажите URL лендинга в About → Website репозитория.

Пока workflow не завершился успешно, этот адрес нельзя считать опубликованным. При переносе репозитория или подключении домена обновите canonical, hreflang, og:url, og:image, robots.txt и sitemap.xml.

## Локальный просмотр

```sh
python -m http.server 4180 --directory site
```

Откройте `http://localhost:4180/` и `/en/`. Проверьте языковые ссылки, кнопки скачивания, FAQ и ширину окна телефона.
