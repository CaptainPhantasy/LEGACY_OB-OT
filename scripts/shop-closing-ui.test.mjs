import test from 'node:test';
import assert from 'node:assert/strict';
import { setupClosingUI } from '../dist/shop-closing-ui.js';
import { OWNER_LINE } from '../dist/shop-closing.js';

function harness() {
  const nodes = [], calls = [];
  const doc = { activeElement: null, createElement: tag => {
    const listeners = new Map();
    const node = { tag, hidden: false, disabled: false, textContent: '', children: [], attrs: {}, dataset: {},
      setAttribute(name, value) { this.attrs[name] = value; },
      append(...children) { this.children.push(...children); },
      addEventListener(name, callback) { listeners.set(name, callback); },
      click() { listeners.get('click')?.(); },
      focus(options) { doc.activeElement = this; this.focusOptions = options; },
    };
    nodes.push(node);
    return node;
  }, querySelector: selector => selector === '#experience' ? host : null };
  const host = doc.createElement('main');
  const ui = setupClosingUI({ doc, leave: () => calls.push('leave'), hide: () => calls.push('hide'), explore: () => calls.push('explore'), replay: () => calls.push('replay') });
  const node = id => nodes.find(item => item.id === id);
  const snapshot = (state, extras = {}) => ({ state, cycleKey: '2026-10-22', closed: false, canLeave: true, canHide: state === 'choice', ...extras });
  const update = (state, extras, inside = true) => ui.update(snapshot(state, extras), { inside });
  const action = kind => node(`shop-closing-${kind}`);
  return { ui, doc, nodes, calls, host, node, update, action, card: node('shop-closing-card') };
}

test('the warning is nonmodal, always captioned, and initially offers only the leave decision', () => {
  const h = harness();
  assert.equal(h.card.hidden, true);
  h.update('warning');
  assert.equal(h.card.hidden, false);
  assert.equal(h.card.attrs.role, 'region');
  assert.equal(h.card.attrs['aria-modal'], undefined);
  const status = h.nodes.find(node => node.attrs.role === 'status');
  assert.equal(status.attrs['aria-live'], 'polite');
  assert.equal(status.children[0].textContent, `“${OWNER_LINE}”`);
  assert.equal(h.action('leave').hidden, false);
  assert.equal(h.action('hide').hidden, true);
  assert.equal(h.action('explore').hidden, true);
  assert.equal(h.doc.activeElement, null, 'updates never steal movement or reading focus');
  h.action('hide').click();
  assert.deepEqual(h.calls, [], 'a hidden decision cannot be triggered');
  h.action('replay').click(); h.action('leave').click();
  assert.deepEqual(h.calls, ['replay', 'leave']);
});

test('the hide decision requires both the choice state and permission from the model', () => {
  const h = harness();
  h.update('choice', { canHide: false });
  assert.equal(h.action('hide').hidden, true);
  h.update('choice');
  assert.equal(h.action('hide').hidden, false);
  h.action('hide').click();
  assert.deepEqual(h.calls, ['hide']);
  h.update('hiding');
  assert.equal(h.action('hide').hidden, true);
  assert.equal(h.action('replay').hidden, true);
  assert.match(h.nodes.find(node => node.className === 'shop-closing-message').textContent, /Moving into/);
  h.update('hidden', { closed: true });
  assert.match(h.nodes.find(node => node.className === 'shop-closing-message').textContent, /lights have gone off/);
  assert.equal(h.action('explore').hidden, true, 'waiting does not prematurely release exploration');
});

test('only the dark card can be dismissed, and the next closing day restores it', () => {
  const h = harness();
  h.update('warning');
  assert.equal(h.ui.dismiss(), false);
  assert.equal(h.card.hidden, false);
  h.update('dark', { closed: true });
  assert.equal(h.action('explore').hidden, false);
  assert.equal(h.action('leave').hidden, false);
  h.action('explore').click();
  assert.deepEqual(h.calls, ['explore']);
  assert.equal(h.card.hidden, true);
  h.update('dark', { closed: true });
  assert.equal(h.card.hidden, true, 'clock ticks must not reopen a dismissed card');
  h.update('dark', { closed: true, cycleKey: '2026-10-23' });
  assert.equal(h.card.hidden, false);
});

test('outside and inactive states hide every action; explicit focus chooses leave only when available', () => {
  const h = harness();
  h.update('warning');
  assert.equal(h.ui.focusLeave(), true);
  assert.equal(h.doc.activeElement, h.action('leave'));
  assert.deepEqual(h.doc.activeElement.focusOptions, { preventScroll: true });
  h.update('warning', {}, false);
  assert.equal(h.card.hidden, true);
  assert.equal(h.ui.focusLeave(), false);
  h.action('leave').click(); h.action('replay').click();
  assert.deepEqual(h.calls, []);
  h.update('leaving', { canLeave: false });
  assert.equal(h.card.hidden, false);
  assert.equal(h.ui.focusLeave(), false);
  for (const state of ['open', 'outside']) {
    h.update(state);
    assert.equal(h.card.hidden, true);
  }
});
