import "./i18n.test.mjs";
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule, apiUrl } from './load-module.mjs';
const { joinPdfText, findTextMatches } = await loadModule('../src/pdfText.ts');
const { TranslationQueue } = await loadModule('../src/translationQueue.ts', { './libraryApi': apiUrl });
const block = (text, y = 0) => ({ text, x: 0.1, y, width: 0.7, height: 0.1 });
const ok = (result) => ({ success: true, result });
function fixture(overrides = {}) {
  const saved = [];
  const calls = [];
  const api = {
    listTranslationBlocks: async (doc, page) => saved.filter(b => b.documentId === doc && b.pageNumber === page),
    analyzeDocumentPage: async (doc, page) => { calls.push(page); return ok({ blocks: [block('first'), block('second', 0.2)] }); },
    ocrDocumentPage: async () => ok({ blocks: [block('scan')] }),
    translateText: async (text) => ok({ translatedText: text + ' translated' }),
    createTranslationBlock: async (documentId, pageNumber, rect, ocrText, translatedText) => {
      const entry = { id: saved.length + 1, documentId, pageNumber, sourceX: rect.x, sourceY: rect.y, sourceWidth: rect.width, sourceHeight: rect.height, ocrText, translatedText };
      saved.push(entry); return entry;
    }, ...overrides,
  };
  return { queue: new TranslationQueue(api), saved, calls };
}
async function idle(queue) {
  const end = Date.now() + 3000;
  while (queue.getSnapshot().some(j => ['queued', 'running', 'cancelling'].includes(j.status))) {
    if (Date.now() > end) throw new Error('Queue did not finish');
    await new Promise(r => setTimeout(r, 1));
  }
}

test('PDF search crosses text items and preserves offsets, whitespace and literal regex characters', () => {
  const { text, offsets } = joinPdfText(['Hello', 'world', '', ' A+B [x].', 'ПРИВЕТ']);
  assert.equal(text, 'Hello world A+B [x]. ПРИВЕТ');
  assert.deepEqual(offsets, [0, 6, 11, 11, 21]);
  assert.deepEqual(findTextMatches(text, 'hello world', 2).map(m => [m.pageNumber, m.start, m.end]), [[2, 0, 11]]);
  assert.equal(findTextMatches(text, 'A+B [x].', 1).length, 1);
  assert.equal(findTextMatches(text, 'привет', 1)[0].start, 21);
  assert.equal(findTextMatches(text, ' ', 1).length, 0);
  assert.equal(findTextMatches('hello\n  world', 'hello world', 1)[0].end, 13);
});
test('queue processes ranges serially, deduplicates pending pages and skips saved areas on retry', async () => {
  const { queue, saved, calls } = fixture();
  queue.enqueue(1, 'Book', 1, 2); queue.enqueue(1, 'Book', 1, 2);
  await idle(queue);
  assert.deepEqual(calls, [1, 2]); assert.equal(saved.length, 4); assert.equal(queue.getRevision(), 4);
  queue.enqueue(1, 'Book', 1, 1); await idle(queue);
  assert.equal(saved.length, 4); assert.equal(queue.getSnapshot().at(-1).skipped, 2);
});
test('cancelling while model is running prevents saving and leaves queued page runnable', async () => {
  let release;
  const { queue, saved, calls } = fixture({ translateText: () => new Promise(resolve => { release = resolve; }) });
  queue.enqueue(1, 'Book', 1, 2);
  while (!release) await new Promise(r => setTimeout(r, 1));
  queue.cancel(queue.getSnapshot()[0].id); queue.cancel(queue.getSnapshot()[1].id);
  release(ok({ translatedText: 'Late result' })); await idle(queue);
  assert.equal(saved.length, 0); assert.deepEqual(calls, [1]);
  assert.deepEqual(queue.getSnapshot().map(j => j.status), ['cancelled', 'cancelled']);
});
test('retry translates only failed unsaved blocks and continues after a block error', async () => {
  let fail = true;
  const translated = [];
  const { queue, saved } = fixture({ translateText: async text => {
    translated.push(text);
    if (text === 'first' && fail) return { success: false, error: { code: 'TEST', message: 'failed' } };
    return ok({ translatedText: 'result' });
  } });
  queue.enqueue(1, 'Book', 1, 1); await idle(queue);
  assert.equal(saved.length, 1); assert.equal(queue.getSnapshot()[0].failures.length, 1);
  fail = false; queue.retry(queue.getSnapshot()[0].id); await idle(queue);
  assert.deepEqual(translated, ['first', 'second', 'first']); assert.equal(saved.length, 2);
  assert.equal(queue.getSnapshot().at(-1).status, 'done');
});
test('OCR fallback, invalid geometry and per-page failure do not stop other pages', async () => {
  const { queue, saved } = fixture({ analyzeDocumentPage: async (doc, page) => {
    if (page === 1) throw new Error('Broken PDF page');
    return ok({ blocks: [block('invalid', 1)] });
  } });
  queue.enqueue(1, 'Book', 1, 2); await idle(queue);
  assert.deepEqual(queue.getSnapshot().map(j => j.status), ['error', 'done']);
  assert.equal(saved[0].ocrText, 'scan');
});
test('queue continues with no subscribers and publishes saved results to a later subscriber', async () => {
  const { queue, saved } = fixture();
  const unsubscribe = queue.subscribe(() => {});
  queue.enqueue(1, 'Book', 1, 1); unsubscribe(); await idle(queue);
  assert.equal(saved.length, 2); assert.equal(queue.getRevision(), 2);
  queue.clearFinished(); assert.deepEqual(queue.getSnapshot(), []);
});

test('queue captures direction when enqueued and preserves it on retry', async () => {
  let preferences = { sourceLanguage: 'auto', targetLanguage: 'ru' };
  let release;
  const received = [];
  const { queue } = fixture({
    getTranslationSettings: async () => ({ ...preferences }),
    translateText: async (text, source, target) => {
      received.push([source, target]);
      if (!release) await new Promise(resolve => { release = resolve; });
      return { success: false, error: { code: 'TEST', message: 'retry' } };
    },
  });
  queue.enqueue(1, 'Mixed book', 1, 2);
  while (!release) await new Promise(resolve => setTimeout(resolve, 1));
  preferences = { sourceLanguage: 'fr', targetLanguage: 'en' };
  release(); await idle(queue);
  queue.retry(queue.getSnapshot()[0].id); await idle(queue);
  assert(received.every(([source, target]) => source === 'auto' && target === 'ru'));
});

test('already-target fragments remain unchanged without saving redundant overlays', async () => {
  const { queue, saved } = fixture({ translateText: async () => ok({ translatedText: 'original', alreadyTarget: true, usedModels: [] }) });
  queue.enqueue(1, 'Book', 1, 1); await idle(queue);
  assert.equal(saved.length, 0);
  assert.equal(queue.getSnapshot()[0].skipped, 2);
  assert.equal(queue.getSnapshot()[0].processed, 2);
});
