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
  add(page(4)); add(stream('BT /F1 20 Tf 72 700 Td (Hello world) Tj 0 -40 Td (A+B [x].) Tj 0 -630 Td (Bottom target) Tj ET'));
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
  await page.route('**/__test.pdf', route => route.fulfill({ contentType: 'application/pdf', body: testPdf() }));
  await page.addInitScript(() => {
    const doc = { id: 1, title: 'Reader test book', path: '/fixture.pdf', deletedAt: null, shelfIds: [], tagIds: [], lastPage: 1, lastZoom: 'fit-width', createdAt: '', updatedAt: '', originalFilename: 'fixture.pdf', fileSize: 1000 };
    window.__testSaved = [];
    window.__testTranslateCalls = 0;
    window.__testModelsReady = true;
    window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
      switch (command) {
        case 'get_theme': return 'light';
        case 'model_status': return { translationReady: window.__testModelsReady, ocrReady: window.__testModelsReady, bundledRuntime: true, installing: false, downloadBytes: 200000000, modelsPath: '/fixture-models', progress: null };
        case 'install_models': await new Promise(r => setTimeout(r, 100)); window.__testModelsReady = true; return { success: true, result: { ready: true } };
        case 'database_path': return 'fixture.db';
        case 'list_documents': return [doc];
        case 'get_document': return doc;
        case 'read_document_pdf': return fetch('/__test.pdf').then(r => r.arrayBuffer());
        case 'list_shelves': case 'list_tags': case 'list_notes': case 'list_bookmarks': case 'list_dictionary_entries': return [];
        case 'save_reading_state': case 'set_theme': return;
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
  await page.getByRole('button', { name: 'Читать', exact: true }).click();
  await page.waitForSelector('.pdf-text-layer span');
  await page.setViewportSize({ width: 1100, height: 720 });
  await page.locator('.zoom-label input').fill('300');
  await page.locator('.zoom-label input').press('Enter');
  await page.getByRole('button', { name: 'Поиск по книге', exact: true }).click();
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
  await page.getByRole('button', { name: 'Поиск по книге', exact: true }).click();
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
  await page.evaluate(() => { window.__testModelsReady = false; });
  await page.getByRole('button', { name: 'Модели', exact: true }).click();
  await page.getByRole('button', { name: 'Скачать модели', exact: true }).click();
  await page.getByText('Всё готово. Можно распознавать и переводить.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Готово', exact: true }).click();
  await page.screenshot({ path: 'tests/reader-ui.png' });
  assert.deepEqual(errors, []);
  console.log('UI integration passed: search, literal query, Ctrl+F, rotated page, outline, mouse selection, queue across screens, deduplication, narrow layout.');
} finally { await browser.close(); }
