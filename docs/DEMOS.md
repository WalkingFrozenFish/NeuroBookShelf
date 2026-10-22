# Демонстрации / Demo recordings

[Русский README](../README.ru.md) · [English README](../README.md)

## Русский

Анимация показывает библиотеку, чтение PDF, поиск через Ctrl+F, переход к сканированной странице и фоновый OCR с переводом English → Russian. Это рабочая версия, а не опубликованный 0.1.0.

Для записи создан собственный тестовый PDF: первая страница содержит текст, вторая — растровую копию без текстового слоя. PaddleOCR распознаёт вторую страницу; CTranslate2 с установленной моделью en-ru переводит полученные фрагменты. Использованы настоящие ответы упакованного Python worker.

Интерфейс записан в Edge через браузерный сценарий. Команды хранения подменены временными данными, OCR и перевод воспроизводят заранее вычисленные ответы локальных движков. Паузы и кадры сокращены для показа последовательности действий. Запись не измеряет скорость обработки и не проверяет установщик или системные диалоги. Пользовательские книги и база не использовались.

Файлы: [анимация](images/workflow.gif) и [английская версия](images/workflow-en.gif). Каждый содержит шесть кадров с подписями. Статические скриншоты читалки также доступны в README, настройки — в руководстве.

## English

The animation shows the library, PDF reading, Ctrl+F search, a scanned page and background OCR with English → Russian translation. It features the development version rather than the published 0.1.0 release.

A purpose-made sample PDF contains a text page followed by its rasterized copy with no text layer. PaddleOCR recognizes the second page; CTranslate2 with the installed en-ru model translates the recognized fragments. The results are actual responses from the bundled Python worker.

The interface was captured in Edge using a browser scenario. Storage commands use temporary fixtures, while OCR and translation replay previously computed local-engine responses. Pauses and frames are shortened to explain the workflow. This is not a processing-speed benchmark or an installer/system-dialog test. No personal books or library database were used.

Files: [English animation](images/workflow-en.gif) and [Russian animation](images/workflow.gif), each with six captioned frames. Static reader screenshots are also available in the README; settings screenshots are in the user guide.
