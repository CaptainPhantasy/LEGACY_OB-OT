import { shopTime } from './shop-time.js';

export const OWNER_LINE = 'We are closing now. Anyone still back there?';
export const HESITATION_MS = 8000;
export const HIDDEN_WAIT_MS = 6000;
export const CLOSING_STORAGE_KEY = 'legacy-shop-closing-v1';

const STATES = new Set(['open', 'warning', 'choice', 'hiding', 'hidden', 'dark', 'leaving', 'outside']);
const HIDDEN_STATES = new Set(['hidden', 'dark']);

function instant(value) {
  const time = value instanceof Date ? value.getTime() : Number(value);
  if (!Number.isFinite(time)) throw new TypeError('The shop needs a valid time.');
  return time;
}

// A shop day lasts until the following opening, including across midnight and
// either daylight-saving transition. Arithmetic here concerns a date label,
// never an assumed 24-hour interval between local openings.
export function closingCycle(time) {
  if (time.hour >= time.openingHour) return time.dateKey;
  const day = new Date(`${time.dateKey}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() - 1);
  return day.toISOString().slice(0, 10);
}

/**
 * Pure story state; the caller owns movement, rendering, sound, and the clock.
 * Only tick() emits warningNew. Call it on visibility changes as well as the
 * regular clock tick so time away from the page never counts as hesitation.
 */
export class ShopClosing {
  constructor({ storage = null, now = () => Date.now() } = {}) {
    this.storage = storage;
    this.now = typeof now === 'function' ? now : () => now;
    this.state = 'open';
    this.cycleKey = null;
    this.waitMs = 0;
    this.hiddenAt = null;
    this.inside = false;
    this.visible = false;
    this.lastTick = null;
    this.canSave = true;
    this.saved = null;
    try {
      const raw = this.storage?.getItem(CLOSING_STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved?.version === 1 && /^\d{4}-\d{2}-\d{2}$/.test(saved.cycleKey) && STATES.has(saved.state)) this.saved = saved;
      }
    } catch { this.canSave = false; }
    this._refresh(instant(this.now()));
  }

  _save() {
    try {
      this.storage?.setItem(CLOSING_STORAGE_KEY, JSON.stringify({
        version: 1, cycleKey: this.cycleKey, state: this.state,
        waitMs: this.waitMs, hiddenAt: this.hiddenAt,
      }));
    } catch { this.canSave = false; }
  }

  _refresh(nowMs) {
    this.time = shopTime(nowMs);
    const cycle = closingCycle(this.time);
    if (cycle !== this.cycleKey) {
      const saved = this.saved;
      this.cycleKey = cycle;
      this.state = 'open';
      this.waitMs = 0;
      this.hiddenAt = null;
      this.lastTick = null;
      if (saved?.cycleKey === cycle) {
        // A chosen destination is not proof of arrival. An interrupted hide
        // returns to the choice; an interrupted exit returns to the street.
        this.state = saved.state === 'hiding' ? 'choice' : saved.state === 'leaving' ? 'outside' : saved.state;
        this.waitMs = Number.isFinite(saved.waitMs) ? Math.max(0, Math.min(HESITATION_MS, saved.waitMs)) : 0;
        this.hiddenAt = Number.isFinite(saved.hiddenAt) ? Math.min(nowMs, saved.hiddenAt) : null;
        if (HIDDEN_STATES.has(this.state) && this.hiddenAt === null) this.state = 'choice';
      }
      this.saved = null;
      this._save();
    }
    return this.time;
  }

  snapshot(warningNew = false) {
    const resumeHidden = HIDDEN_STATES.has(this.state);
    return Object.freeze({
      state: this.state, cycleKey: this.cycleKey,
      closed: this.time.isClosed, lightsOff: this.time.isClosed,
      warningNew, ownerLine: OWNER_LINE,
      canHide: this.inside && this.state === 'choice',
      canLeave: this.inside && !['leaving', 'outside'].includes(this.state),
      canEnter: !this.time.isClosed || resumeHidden,
      resumeHidden, waitMs: this.waitMs, hiddenAt: this.hiddenAt,
      canSave: this.canSave,
    });
  }

  tick(nowMs = this.now(), { inside = this.inside, visible = true } = {}) {
    const now = instant(nowMs);
    this._refresh(now);
    const previousTick = this.lastTick;
    const wasVisible = this.visible;
    this.inside = Boolean(inside);
    this.visible = Boolean(visible);
    let warningNew = false;
    if (this.inside && this.visible && this.state === 'open' && (this.time.isClosingSoon || this.time.isClosed)) {
      this.state = 'warning';
      this.waitMs = 0;
      warningNew = true;
      this._save();
    } else if (this.state === 'warning' && this.inside && this.visible && wasVisible && previousTick !== null) {
      this.waitMs = Math.min(HESITATION_MS, this.waitMs + Math.max(0, now - previousTick));
      if (this.waitMs >= HESITATION_MS) {
        this.state = 'choice';
        this._save();
      }
    }
    if (this.state === 'hidden' && this.time.isClosed && now - this.hiddenAt >= HIDDEN_WAIT_MS) {
      this.state = 'dark';
      this._save();
    }
    this.lastTick = now;
    return this.snapshot(warningNew);
  }

  enter(nowMs = this.now()) {
    this._refresh(instant(nowMs));
    if (!this.snapshot().canEnter) return this.snapshot();
    this.inside = true;
    if (this.state === 'outside' || this.state === 'leaving') {
      this.state = 'open';
      this.waitMs = 0;
      this.hiddenAt = null;
      this._save();
    }
    return this.snapshot();
  }

  chooseHide(nowMs = this.now()) {
    this._refresh(instant(nowMs));
    if (!this.snapshot().canHide) return this.snapshot();
    this.state = 'hiding';
    this._save();
    return this.snapshot();
  }

  confirmHidden(nowMs = this.now()) {
    const now = instant(nowMs);
    this._refresh(now);
    if (this.state !== 'hiding') return this.snapshot();
    this.state = 'hidden';
    this.hiddenAt = now;
    this._save();
    return this.snapshot();
  }

  cancelHide(nowMs = this.now()) {
    this._refresh(instant(nowMs));
    if (this.state === 'hiding') {
      this.state = 'choice';
      this._save();
    }
    return this.snapshot();
  }

  chooseLeave(nowMs = this.now()) {
    this._refresh(instant(nowMs));
    if (!this.snapshot().canLeave) return this.snapshot();
    this.state = 'leaving';
    this._save();
    return this.snapshot();
  }

  confirmLeave(nowMs = this.now()) {
    this._refresh(instant(nowMs));
    if (this.state !== 'leaving') return this.snapshot();
    this.state = 'outside';
    this.inside = false;
    this.hiddenAt = null;
    this._save();
    return this.snapshot();
  }
}
