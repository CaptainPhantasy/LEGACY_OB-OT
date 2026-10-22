import { OWNER_LINE } from './shop-closing.js';

const COPY = {
  warning: ['From around the corner', 'The owner is closing the shop. The glass front door leads out to the street.'],
  choice: ['Still here?', 'There is a low space behind the reading table, out of sight of the owner.'],
  hiding: ['Behind the reading table', 'Moving into the low space. Stay close to the floor.'],
  hidden: ['Keep low for a moment', 'You are behind the reading table. The owner is finishing up.'],
  dark: ['The shop falls quiet', 'The lights are out. You can keep exploring, or leave through the glass front door.'],
  leaving: ['Through the glass door', 'Making your way out to the street.'],
};

/** A captioned, nonmodal choice. Movement and story timing belong to the caller. */
export function setupClosingUI({ leave = () => {}, hide = () => {}, explore = () => {}, replay = () => {}, doc = document } = {}) {
  const host = doc.querySelector('#experience');
  if (!host) throw new Error('The closing card needs the shop experience.');
  const make = (tag, className, id) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (id) node.id = id;
    return node;
  };
  const card = make('section', 'shop-closing-card', 'shop-closing-card');
  card.hidden = true;
  card.setAttribute('role', 'region');
  card.setAttribute('aria-labelledby', 'shop-closing-title');
  const heading = make('h2', '', 'shop-closing-title');
  const status = make('div', 'shop-closing-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');
  const quote = make('p', 'shop-closing-quote');
  const message = make('p', 'shop-closing-message');
  status.append(quote, message);
  const actions = make('div', 'shop-closing-actions');
  const button = (id, text, action, className = '') => {
    const node = make('button', className, id);
    node.type = 'button';
    node.textContent = text;
    node.addEventListener('click', () => {
      if (!node.hidden && !node.disabled && !card.hidden) action();
    });
    return node;
  };
  const leaveButton = button('shop-closing-leave', 'Leave through the front door', leave, 'shop-closing-primary');
  const hideButton = button('shop-closing-hide', 'Hide behind reading table', hide);
  const exploreButton = button('shop-closing-explore', 'Keep exploring', () => { dismiss(); explore(); }, 'shop-closing-primary');
  const replayButton = button('shop-closing-replay', 'Hear the owner’s call', replay, 'shop-closing-replay');
  replayButton.setAttribute('aria-label', 'Hear the owner’s closing call with sound');
  actions.append(leaveButton, hideButton, exploreButton);
  card.append(heading, status, actions, replayButton);
  host.append(card);

  let current = null;
  let inside = false;
  let cycle = null;
  let dismissedCycle = null;
  let rendered = '';

  function update(snapshot, context = {}) {
    current = snapshot;
    inside = context.inside ?? inside;
    if (cycle !== snapshot.cycleKey) {
      cycle = snapshot.cycleKey;
      dismissedCycle = null;
    }
    const state = snapshot.state;
    const copy = COPY[state];
    card.hidden = !inside || !copy || (state === 'dark' && dismissedCycle === cycle);
    card.dataset.state = state;
    const key = `${state}:${Boolean(snapshot.closed)}`;
    if (copy && key !== rendered) {
      heading.textContent = copy[0];
      quote.textContent = `“${OWNER_LINE}”`;
      message.textContent = state === 'hidden' && snapshot.closed
        ? 'You are out of sight. The lights have gone off. Stay low for a moment.'
        : copy[1];
      rendered = key;
    }
    leaveButton.hidden = !snapshot.canLeave || state === 'leaving';
    hideButton.hidden = state !== 'choice' || !snapshot.canHide;
    exploreButton.hidden = state !== 'dark';
    replayButton.hidden = !['warning', 'choice'].includes(state);
    actions.hidden = leaveButton.hidden && hideButton.hidden && exploreButton.hidden;
    return !card.hidden;
  }

  function focusLeave() {
    if (!card.hidden && !leaveButton.hidden && !leaveButton.disabled) {
      leaveButton.focus({ preventScroll: true });
      return true;
    }
    return false;
  }

  function dismiss() {
    if (current?.state !== 'dark') return false;
    dismissedCycle = cycle;
    update(current, { inside });
    return true;
  }

  return { update, focusLeave, dismiss };
}
