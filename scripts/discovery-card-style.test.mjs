import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../dist/style.css', import.meta.url), 'utf8');
const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
// Inspect every declaration, including later media rules. Checking only the
// original transparency rule missed the more-specific shelf override before.
const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(([, selector, body]) => ({ selector: selector.trim(), declarations: Object.fromEntries(
    body.split(';').filter(part => part.includes(':')).map(part => {
      const colon = part.indexOf(':');
      return [part.slice(0, colon).trim(), part.slice(colon + 1).trim()];
    })) }));
const cards = rules.filter(rule => /\.discovery-panel|#shelf-panel|\.rabbit-holes|\.chair-panel/.test(rule.selector));

test('no card, description, link, or control rule reintroduces an opaque surface', () => {
  for (const { selector, declarations } of cards) {
    for (const property of ['background', 'background-color', 'background-image']) {
      if (declarations[property]) assert.match(declarations[property], /^(transparent|none)$/,
        `${selector} makes ${property} opaque again`);
    }
    if (declarations['backdrop-filter']) assert.equal(declarations['backdrop-filter'], 'none', selector);
  }
});

test('transparent card gaps remain a native scrolling surface instead of passing drags into the room', () => {
  const shared = rules.find(rule => rule.selector === '.discovery-panel,.explore-menu' && rule.declarations['touch-action']);
  assert.ok(shared, 'Both original and middle cards share native scrolling input');
  assert.equal(shared.declarations['pointer-events'], 'auto');
  assert.equal(shared.declarations['touch-action'], 'pan-y');
  assert.equal(shared.declarations['overscroll-behavior-y'], 'contain');
  assert.ok(rules.some(rule => rule.selector === '.discovery-panel' && rule.declarations.overflow === 'auto'));
  // A more specific ID rule must never override the shared input surface.
  for (const { selector, declarations } of cards) {
    const root = selector.split(',').some(part => /^(?:\.discovery-panel|#shelf-panel(?:\.shelf-inspection)?)$/.test(part.trim()));
    if (root) assert.notEqual(declarations['pointer-events'], 'none', selector);
  }
});

test('the complete description is outside the disclosure and no style hides or truncates it', () => {
  const panel = html.match(/<section id="shelf-panel"[\s\S]*?<\/section>/)?.[0];
  assert.ok(panel);
  assert.ok(panel.indexOf('id="curiosity-description"') < panel.indexOf('<details'));
  assert.doesNotMatch(panel, /id="shelf-object-note"/, 'The description is not duplicated in collapsed content');
  for (const { selector, declarations } of cards.filter(rule => rule.selector.includes('#curiosity-description'))) {
    assert.notEqual(declarations.display, 'none', selector);
    assert.notEqual(declarations.overflow, 'hidden', selector);
    assert.equal(declarations['-webkit-line-clamp'], undefined, selector);
  }
});

test('both discovery scroll regions can receive keyboard focus and have an accessible name', () => {
  for (const id of ['shelf-panel', 'chair-panel']) {
    const tag = html.match(new RegExp(`<section id="${id}"[^>]*>`))?.[0];
    assert.match(tag, /tabindex="0"/);
    const title = tag.match(/aria-labelledby="([^"]+)"/)?.[1];
    assert.ok(title);
    assert.ok(html.includes(`id="${title}"`));
  }
  assert.ok(rules.some(rule => rule.selector.includes('.discovery-panel:focus-visible') && rule.declarations.outline));
});


test('the complete places menu also accepts native scrolling and keyboard focus', () => {
  const tag = html.match(/<aside id="explore-menu"[^>]*>/)?.[0];
  assert.match(tag, /tabindex="0"/);
  assert.match(tag, /aria-label="Places to explore"/);
  const shared = rules.find(rule => rule.selector === '.discovery-panel,.explore-menu' && rule.declarations['touch-action']);
  assert.equal(shared.declarations['pointer-events'], 'auto');
  assert.equal(shared.declarations['touch-action'], 'pan-y');
  assert.equal(shared.declarations['overscroll-behavior-y'], 'contain');
});
