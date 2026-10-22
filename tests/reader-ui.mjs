// Browser integration test. Start npm run dev first. Uses an installed Playwright
// via LLR_PLAYWRIGHT_MODULE; real Tauri commands and user data are never touched.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.LLR_PLAYWRIGHT_MODULE || 'playwright');

function testPdf() {
  const objects = [];
  const add = (s) => { objects.push(s); return objects.length; };
  add('<< /Type /Catalog /Pages 2 0 R /Outlines 11 0 R >>');
  add('<< /Type /Pages /Kids [3 0 R 5 0 R 7 0 R] /Count 3 >>');
  const page = (content, rotation = 0) => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Rotate ${rotation} /Resources << /Font << /F1 9 0 R >> >> /Contents ${content} 0 R >>`;
  const stream = (text) => `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`;
  add(page(4)); add(stream('BT /F1 20 Tf 72 700 Td (Hello world) Tj 0 -40 Td (A+B [x].) Tj /F1 13 Tf 0 -70 Td (READING BEYOND THE PAGE) Tj 0 -30 Td (A book is more than a file in a folder.) Tj 0 -24 Td (It is a place to explore an idea, follow a question,) Tj 0 -24 Td (and keep the passages you want to revisit.) Tj 0 -48 Td (01 / Build a personal library) Tj 0 -24 Td (Give your documents a home with shelves and tags.) Tj 0 -24 Td (Your reading position is saved for the next session.) Tj 0 -48 Td (02 / Stay close to the text) Tj 0 -24 Td (Search a phrase, leave a note, or save a word.) Tj 0 -24 Td (Translate a passage without leaving the page.) Tj 0 -48 Td (03 / Keep it on your computer) Tj 0 -24 Td (After the initial model download, work offline.) Tj 0 -24 Td (Your documents remain in your own library.) Tj 0 -194 Td /F1 20 Tf (Bottom target) Tj ET'));
  add(page(6, 90)); add(stream('BT /F1 20 Tf 72 700 Td (Hello second page) Tj ET'));
  add(page(8)); add(stream(''));
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  add('<< /Title (Chapter one) /Parent 11 0 R /Dest [3 0 R /Fit] /Next 12 0 R >>');
  add('<< /Type /Outlines /First 10 0 R /Last 12 0 R /Count 2 >>');
  add('<< /Title (Chapter two) /Parent 11 0 R /Dest [5 0 R /Fit] /Prev 10 0 R >>');
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((obj, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}
const browser = await chromium.launch({ channel: process.env.LLR_BROWSER_CHANNEL || 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  // Slow completion deterministically so intermediate PDF frames can be inspected.
  await page.route('**/src/pages/ReaderPage.tsx*', async route => {
    const response = await route.fetch();
    const source = await response.text();
    assert.ok(source.includes('await state.task.promise;'));
    await route.fulfill({ response, body: source.replaceAll('await state.task.promise;',
      'await state.task.promise; await new Promise(resolve => setTimeout(resolve, window.__testRenderDelay || 0));') });
  });
  await page.route('**/__test.pdf', route => route.fulfill({ contentType: 'application/pdf', body: testPdf() }));
  await page.addInitScript(() => {
    const doc = { id: 1, title: 'A short guide to local reading', path: '/fixture.pdf', deletedAt: null, shelfIds: [], tagIds: [], lastPage: 1, lastZoom: 'fit-width', createdAt: '', updatedAt: '', originalFilename: 'fixture.pdf', fileSize: 1000 };
    window.__testSaved = [];
    window.__testBooks = [doc];
    window.__testTrash = [{ ...doc, id: 2, title: 'Restorable book', deletedAt: '2026-10-20T10:00:00Z' }];
    window.__testResetCalls = 0;
    window.__testTranslateCalls = 0;
    window.__testModelsReady = true;
    window.__testActivePair = 'en-ru';
    window.__testTranslationSettings = { sourceLanguage: 'en', targetLanguage: 'ru' };
    window.__testInstalling = false;
    window.__testProgress = null;
    window.__testFrenchReady = false;
    window.__testAppearance = { mode: 'dark', accent: 'blue', pdf: 'original' };
    window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
      switch (command) {
        case 'get_appearance': return window.__testAppearance;
        case 'set_appearance': window.__testAppearance = args.appearance; return;
        case 'get_translation_settings': return { ...window.__testTranslationSettings };
        case 'set_translation_settings': window.__testTranslationSettings = { ...args.settings }; return;
        case 'refresh_model_catalog': return { success: true, result: {} };
        case 'model_status': return { settings: window.__testTranslationSettings, catalogUpdatedAt: Date.now()/1000, lastTranslation: null, activePair: window.__testActivePair, catalog: [{ pair: 'en-ru', name: 'English → Russian', source: 'en', target: 'ru', sourceName: 'English', targetName: 'Russian', version: '1.9', bytes: 195746693, ready: window.__testModelsReady }, { pair: 'fr-en', name: 'French → English', source: 'fr', target: 'en', sourceName: 'French', targetName: 'English', version: '1.9', bytes: 66585033, ready: window.__testFrenchReady }], translationReady: window.__testModelsReady, ocrReady: window.__testModelsReady, bundledRuntime: true, installing: window.__testInstalling, downloadBytes: 200000000, modelsPath: '/fixture-models', progress: window.__testProgress };
        case 'install_models':
          window.__testInstalling = true;
          window.__testProgress = { phase: 'downloading', downloaded: 1000000, total: 66000000 };
          await new Promise(r => setTimeout(r, args.pair === 'fr-en' ? 2500 : 100));
          window.__testInstalling = false;
          if (window.__testProgress.phase === 'cancelled') return { success: false, error: { code: 'DOWNLOAD_CANCELLED', message: 'Download cancelled' } };
          if (args.pair === 'fr-en') window.__testFrenchReady = true; else window.__testModelsReady = true;
          window.__testProgress = { phase: 'ready' }; return { success: true, result: { ready: true } };
        case 'cancel_model_download': window.__testProgress = { phase: 'cancelled' }; return;
        case 'select_translation_model': window.__testActivePair = args.pair; return;
        case 'database_path': return 'fixture.db';
        case 'list_documents': return window.__testBooks;
        case 'list_trash': return window.__testTrash;
        case 'restore_document': { const book = window.__testTrash.find(item => item.id === args.id); window.__testTrash = window.__testTrash.filter(item => item.id !== args.id); const restored = { ...book, deletedAt: null }; window.__testBooks.push(restored); return restored; }
        case 'reset_shelves': case 'reset_tags': case 'clear_library': window.__testResetCalls++; return;
        case 'get_document': return doc;
        case 'read_document_pdf': return fetch('/__test.pdf').then(r => r.arrayBuffer());
        case 'list_shelves': case 'list_tags': case 'list_notes': case 'list_bookmarks': case 'list_dictionary_entries': return [];
        case 'save_reading_state': return;
        case 'list_translation_blocks': return window.__testSaved.filter(b => b.pageNumber === args.pageNumber);
        case 'analyze_document_page': return { success: true, result: { hasTextLayer: true, blocks: [{ text: 'Hello test', x: 0.1, y: 0.1, width: 0.4, height: 0.1 }, { text: 'Second block', x: 0.1, y: 0.3, width: 0.4, height: 0.1 }] } };
        case 'translate_text': window.__testTranslateCalls++; await new Promise(r => setTimeout(r, 550)); return { success: true, result: { translatedText: 'Переведено', translator: 'fixture' } };
        case 'create_translation_block': {
          const entry = { ...args, id: window.__testSaved.length + 1 };
          window.__testSaved.push(entry); return entry;
        }
        default: throw new Error('Unexpected command: ' + command);
      }
    } };
  });
  await page.goto(process.env.LLR_TEST_URL || 'http://localhost:1420');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'Читалка', exact: true }).click();
  await page.getByRole('heading', { name: 'Выберите книгу для чтения', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Открыть библиотеку', exact: true }).click();
  await page.getByRole('button', { name: 'Читать', exact: true }).click();
  await page.waitForSelector('.pdf-text-layer span');
  // A partially rendered white bitmap must stay hidden behind the theme's fill.
  for (const pdfMode of ['original', 'dimmed', 'night']) {
    await page.getByRole('combobox', { name: 'Отображение PDF', exact: true }).selectOption(pdfMode);
    await page.evaluate(() => { window.__testRenderDelay = 750; });
    await page.getByRole('button', { name: 'Вперёд', exact: true }).click();
    await page.waitForSelector('.page-frame[data-rendering="true"]', { state: 'attached' });
    const pending = await page.locator('.page-frame').evaluate(frame => ({
      background: getComputedStyle(frame).backgroundColor,
      visibility: getComputedStyle(frame.querySelector('canvas')).visibility,
      busy: frame.getAttribute('aria-busy'),
      textLayers: frame.querySelectorAll('.pdf-text-layer').length,
    }));
    assert.equal(pending.visibility, 'hidden');
    assert.equal(pending.busy, 'true');
    assert.equal(pending.textLayers, 0);
    assert.ok(pending.background.match(/\d+/g).slice(0, 3).every(value => Number(value) < 100));
    await page.waitForSelector('.page-frame[data-rendering="false"]');
    assert.equal(await page.locator('.page-frame canvas').evaluate(c => getComputedStyle(c).visibility), 'visible');
    // Abandoned draws must not reveal their page after a newer navigation starts.
    await page.getByRole('button', { name: 'Назад', exact: true }).click();
    await page.getByRole('button', { name: 'Вперёд', exact: true }).click();
    await page.waitForSelector('.reader[data-reader-page="2"] .page-frame[data-rendering="false"]');
    await page.getByRole('button', { name: 'Назад', exact: true }).click();
    await page.waitForSelector('.reader[data-reader-page="1"] .page-frame[data-rendering="false"]');
  }
  await page.evaluate(() => { window.__testRenderDelay = 0; });
  await page.getByRole('combobox', { name: 'Отображение PDF', exact: true }).selectOption('original');
  await page.setViewportSize({ width: 1100, height: 720 });
  await page.locator('.zoom-label input').fill('300');
  await page.locator('.zoom-label input').press('Enter');
  await page.getByRole('button', { name: 'Поиск', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Найти в книге' }).fill('Bottom target');
  await page.locator('.pdf-search-results button').first().click();
  await page.waitForSelector('.pdf-match.current');
  const scrollState = await page.evaluate(() => ({
    appTop: document.querySelector('.app').scrollTop,
    appLeft: document.querySelector('.app').scrollLeft,
    contentTop: document.querySelector('.content').scrollTop,
    rootTop: document.scrollingElement.scrollTop,
    headerTop: document.querySelector('.topbar').getBoundingClientRect().top,
    pageTop: document.querySelector('.page-view').scrollTop,
  }));
  console.log('Scroll containment:', scrollState);
  assert.equal(scrollState.appTop, 0);
  assert.equal(scrollState.appLeft, 0);
  assert.equal(scrollState.contentTop, 0);
  assert.equal(scrollState.rootTop, 0);
  assert.equal(scrollState.headerTop, 0);
  assert.ok(scrollState.pageTop > 0, 'Only the PDF viewport should scroll to the search hit');
  const pdfBounds = await page.locator('.page-view').boundingBox();
  await page.mouse.move(pdfBounds.x + pdfBounds.width / 2, pdfBounds.y + pdfBounds.height / 2);
  await page.mouse.wheel(0, 15000);
  // Wait for the real wheel event to reach the PDF viewport before checking the shell.
  await page.waitForFunction(() => {
    const panel = document.querySelector('.page-view');
    return panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 2;
  });
  await page.mouse.wheel(0, 15000);
  await page.waitForFunction(() => document.querySelector('.topbar').getBoundingClientRect().top === 0);
  assert.equal(await page.locator('.app').evaluate(el => el.scrollTop), 0);
  assert.equal(await page.locator('.content').evaluate(el => el.scrollTop), 0);
  assert.equal(await page.evaluate(() => document.scrollingElement.scrollTop), 0);
  await page.getByRole('button', { name: 'По ширине', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Поиск', exact: true }).click();
  const input = page.getByRole('searchbox', { name: 'Найти в книге' });
  await input.fill('hello');
  await page.waitForFunction(() => document.querySelectorAll('.pdf-search-results li').length === 2);
  await page.locator('.pdf-search-results button').first().click();
  await page.waitForSelector('.pdf-match.current');
  assert.equal(await page.locator('.pdf-match.current').first().textContent(), 'Hello');
  await page.keyboard.press('Control+f');
  assert.equal(await input.evaluate(el => document.activeElement === el), true);
  await page.locator('.pdf-search-results button').nth(1).click();
  await page.waitForSelector('.reader[data-reader-page="2"] .pdf-text-layer[data-main-rotation="90"] .pdf-match.current');
  // Text geometry remains inside the rendered page after PDF rotation.
  const geometry = await page.locator('.pdf-match.current').first().evaluate(el => {
    const r = el.getBoundingClientRect(), p = el.closest('.page-frame').getBoundingClientRect();
    return r.left >= p.left - 2 && r.right <= p.right + 2 && r.top >= p.top - 2 && r.bottom <= p.bottom + 2;
  });
  assert.equal(geometry, true);
  await page.getByRole('button', { name: 'Оглавление', exact: true }).click();
  await page.getByRole('button', { name: 'Chapter one', exact: true }).click();
  await page.waitForSelector('.reader[data-reader-page="1"] .pdf-text-layer span');
  // Native mouse selection, not a synthetic textContent extraction.
  const textSpan = page.locator('.pdf-text-layer span').filter({ hasText: 'Hello world' }).first();
  const rect = await textSpan.boundingBox();
  await page.mouse.move(rect.x + 1, rect.y + rect.height / 2);
  await page.mouse.down(); await page.mouse.move(rect.x + rect.width - 1, rect.y + rect.height / 2, { steps: 12 }); await page.mouse.up();
  assert.match(await page.evaluate(() => window.getSelection().toString()), /Hello world/);
  await page.keyboard.press('Control+c');
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /Hello world/);
  // Switching pages and screens must not cancel background translation.
  await page.getByRole('button', { name: 'Перевести диапазон страниц', exact: true }).click();
  await page.getByLabel('По', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Добавить в очередь', exact: true }).click();
  await page.getByRole('button', { name: 'Вперёд', exact: true }).click();
  await page.getByRole('button', { name: 'Библиотека', exact: true }).click();
  await page.waitForFunction(() => window.__testSaved.length === 4);
  await page.waitForFunction(() => !document.querySelector('.queue-job progress'));
  assert.equal(await page.locator('.queue-job').count(), 2);
  assert.equal(await page.evaluate(() => window.__testTranslateCalls), 4);
  await page.getByRole('button', { name: 'Читать', exact: true }).click();
  await page.getByRole('button', { name: 'Перевести страницу в фоне', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.queue-job').length === 3 && !document.querySelector('.queue-job progress'));
  assert.equal(await page.evaluate(() => window.__testTranslateCalls), 4);
  // Narrow layout: Ctrl+F opens the drawer, search remains operable.
  await page.setViewportSize({ width: 900, height: 800 });
  await page.keyboard.press('Control+f');
  await page.waitForSelector('.thumbs.is-open');
  await page.getByRole('searchbox', { name: 'Найти в книге' }).fill('A+B [x].');
  await page.waitForFunction(() => document.querySelectorAll('.pdf-search-results li').length === 1);
  await page.locator('.thumbs-close').click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Вперёд', exact: true }).click();
  await page.getByRole('button', { name: 'Вперёд', exact: true }).click();
  await page.getByRole('button', { name: 'Перевести страницу в фоне', exact: true }).click();
  await page.waitForFunction(() => window.__testTranslateCalls === 5);
  await page.locator('.queue-job').last().getByRole('button', { name: 'Отменить', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.queue-job progress'));
  assert.equal(await page.evaluate(() => window.__testSaved.length), 4);
  await page.locator('.queue-job').last().getByRole('button', { name: 'Продолжить / повторить ошибки', exact: true }).click();
  await page.waitForFunction(() => window.__testSaved.length === 6 && !document.querySelector('.queue-job progress'));
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await page.getByRole('button', { name: 'Убрать завершённые', exact: true }).click();
  await page.getByRole('button', { name: 'Страницы', exact: true }).click();
  await page.screenshot({ path: 'tests/reader-preview.png' });
  await page.evaluate(() => { window.__testModelsReady = false; });
  await page.getByRole('button', { name: 'Библиотека', exact: true }).click();
  await page.getByRole('button', { name: 'Настройки', exact: true }).click();
  assert.equal(await page.locator('.topbar').getByRole('button', { name: 'Корзина', exact: true }).count(), 0);
  assert.equal(await page.getByRole('tab', { name: 'Общие', exact: true }).getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('.model-table').count(), 0, 'Model catalog loads only when its tab is opened');
  await page.getByRole('tab', { name: 'Общие', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('tabpanel', { name: 'Данные', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Сбросить полки', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Нет, оставить', exact: true }).click();
  assert.equal(await page.evaluate(() => window.__testResetCalls), 0);
  await page.getByRole('tab', { name: 'Данные', exact: true }).focus();
  await page.keyboard.press('Home');
  await page.getByRole('tabpanel', { name: 'Общие', exact: true }).waitFor();
  await page.getByRole('tab', { name: 'OCR и перевод', exact: true }).click();
  await page.locator('.model-table tbody tr').filter({ hasText: 'English → Russian' }).getByRole('button', { name: 'Скачать', exact: true }).click();
  await page.waitForFunction(() => window.__testModelsReady && !window.__testInstalling);
  await page.getByRole('tab', { name: 'Общие', exact: true }).click();
  await page.getByRole('combobox', { name: 'Язык интерфейса', exact: true }).selectOption('en');
  await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor();
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  await page.getByRole('tab', { name: 'Appearance', exact: true }).click();
  await page.getByRole('button', { name: 'Dark', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Light', exact: true }).click();
  await page.waitForFunction(() => window.__testAppearance.mode === 'light');
  await page.getByRole('button', { name: 'Dark', exact: true }).click();
  await page.waitForFunction(() => window.__testAppearance.mode === 'dark');
  await page.getByLabel('Custom color', { exact: true }).fill('#ea681e');
  await page.getByRole('button', { name: 'Apply color', exact: true }).click();
  await page.waitForFunction(() => window.__testAppearance.accent === 'custom');
  assert.equal(await page.evaluate(() => window.__testAppearance.customColor), '#ea681e');
  const hue = await page.locator('html').evaluate(el => Number(el.style.getPropertyValue('--hue')));
  assert.ok(hue > 20 && hue < 24);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('llr-appearance')).language), 'en');
  await page.screenshot({ path: 'tests/settings-appearance-en.png' });
  await page.getByRole('tab', { name: 'OCR & translation', exact: true }).click();
  const frenchRow = page.locator('.model-table tbody tr').filter({ hasText: 'French → English' });
  await frenchRow.getByRole('button', { name: 'Download', exact: true }).click();
  await page.getByRole('tab', { name: 'General', exact: true }).click();
  await page.getByRole('tabpanel', { name: 'General', exact: true }).waitFor();
  await page.getByRole('tab', { name: 'OCR & translation', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel download', exact: true }).click();
  await page.getByText('Download cancelled. Completed files are kept; you can try again.', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__testFrenchReady), false);
  await frenchRow.getByRole('button', { name: 'Download', exact: true }).click();
  await frenchRow.getByText('Selected automatically', { exact: true }).waitFor();
  await page.getByRole('combobox', { name: 'Source language', exact: true }).selectOption('fr');
  await page.waitForFunction(() => window.__testTranslationSettings.sourceLanguage === 'fr');
  await page.getByRole('combobox', { name: 'Translate into', exact: true }).selectOption('en');
  await page.waitForFunction(() => window.__testTranslationSettings.targetLanguage === 'en');
  await page.getByRole('searchbox', { name: 'Search models', exact: true }).fill('fr');
  assert.equal(await page.locator('.model-table tbody tr').count(), 1);
  await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
  assert.equal(await page.locator('.model-table tbody tr').count(), 2);
  await page.screenshot({ path: 'tests/settings-en.png' });
  await page.getByRole('tab', { name: 'General', exact: true }).click();
  await page.getByRole('combobox', { name: 'Interface language', exact: true }).selectOption('ru');
  await page.getByRole('heading', { name: 'Настройки', exact: true }).waitFor();
  await page.getByRole('tab', { name: 'Оформление', exact: true }).click();
  await page.getByRole('button', { name: 'Светлый', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Светлый', exact: true }).click();
  await page.waitForFunction(() => window.__testAppearance.mode === 'light');
  await page.screenshot({ path: 'tests/settings-appearance-ru.png' });
  for (const size of [{ width: 900, height: 800 }, { width: 600, height: 850 }]) {
    await page.setViewportSize(size);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    for (const tab of ['Общие', 'Данные', 'OCR и перевод', 'Оформление']) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      assert.equal(await page.getByRole('tabpanel', { name: tab, exact: true }).isVisible(), true);
      assert.ok(await page.locator('.settings-screen').evaluate(el => el.scrollWidth <= el.clientWidth));
    }
    await page.screenshot({ path: `tests/settings-narrow-${size.width}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Корзина', exact: true }).click();
  await page.getByRole('heading', { name: 'Корзина', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Корзина', exact: true }).getAttribute('aria-current'), 'page');
  await page.locator('.trash-card').getByRole('button', { name: 'Восстановить', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Да, восстановить', exact: true }).click();
  await page.getByText('Удалённых документов нет.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Все книги', exact: false }).click();
  await page.getByText('Restorable book', { exact: true }).waitFor();
  assert.equal(await page.locator('.mini-row').first().locator('.count').textContent(), '2');
  await page.getByRole('searchbox', { name: 'Поиск книг на выбранной полке', exact: true }).fill('no-match-fixture');
  await page.getByRole('heading', { name: 'Ничего не найдено.', exact: true }).waitFor();
  assert.equal(await page.locator('[data-dictionary-card]').count(), 0);
  await page.getByRole('button', { name: 'Сбросить фильтры', exact: true }).click();
  await page.getByText('Restorable book', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Настройки', exact: true }).click();
  await page.getByRole('tab', { name: 'Общие', exact: true }).waitFor();
  await page.screenshot({ path: 'tests/reader-ui.png' });
  assert.deepEqual(errors, []);
  console.log('UI integration passed: themed PDF loading in all three modes, rapid navigation, search, literal query, Ctrl+F, rotated page, outline, mouse selection, queue across screens, deduplication, narrow layout.');
} finally { await browser.close(); }
