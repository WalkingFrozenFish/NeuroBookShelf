import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import ts from 'typescript';
import { loadModule } from './load-module.mjs';
const english = JSON.parse(readFileSync(new URL('../src/locales/en.json', import.meta.url), 'utf8'));
const moduleUrl = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const { t, setUiLanguage } = await loadModule('../src/i18n.ts', {
  react: moduleUrl('export function useSyncExternalStore() {}'),
  './locales/en.json': moduleUrl('export default ' + JSON.stringify(english)),
});
globalThis.document = { documentElement: { lang: 'ru' } };

test('interface language switches both ways and preserves interpolation values', () => {
  setUiLanguage('en');
  assert.equal(t('Библиотека'), 'Library');
  assert.equal(t('Страница {0}', [12]), 'Page 12');
  assert.equal(t('Название документа'), 'Document title');
  assert.equal(t('Действия: {0}', ['My {0} book']), 'Actions: My {0} book');
  assert.equal(document.documentElement.lang, 'en');
  setUiLanguage('ru');
  assert.equal(t('Библиотека'), 'Библиотека');
  assert.equal(t('Страница {0}', [12]), 'Страница 12');
});
test('English also translates stored queue phases and backend diagnostic details', () => {
  setUiLanguage('en');
  assert.equal(t('Перевод блока 2 из 7'), 'Translating block 2 of 7');
  assert.equal(t('MODEL_MISSING: Сначала загрузите модель'), 'MODEL_MISSING: Download the model first');
  assert.equal(t('Не удалось прочитать PDF: sample.pdf'), 'Could not read PDF: sample.pdf');
  setUiLanguage('ru');
});
test('every literal Russian translation key has an English entry', () => {
  const missing = [];
  function scan(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
      if (entry.isDirectory()) { if (entry.name !== 'locales') scan(file); continue; }
      if (!/\.tsx?$/.test(entry.name)) continue;
      const source = ts.createSourceFile(file.pathname, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true,
        entry.name.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      function visit(node) {
        if (ts.isCallExpression(node) && node.expression.getText(source) === 't' && node.arguments.length && ts.isStringLiteral(node.arguments[0])) {
          const key = node.arguments[0].text.replace(/\s+/g, ' ').trim();
          if (/[А-Яа-яЁё]/.test(key) && !(key in english)) missing.push(entry.name + ': ' + key);
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
  scan(new URL('../src/', import.meta.url));
  assert.deepEqual(missing, []);
});
