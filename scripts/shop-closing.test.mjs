import test from 'node:test';
import assert from 'node:assert/strict';
import { ShopClosing, OWNER_LINE, CLOSING_STORAGE_KEY } from '../dist/shop-closing.js';

const ms = value => Date.parse(value);
const oct = (time, day = '22') => ms(`2026-10-${day}T${time}-04:00`);
function memory() {
  const records = new Map();
  return { getItem:key=>records.get(key)??null, setItem:(key,value)=>records.set(key,value), records };
}
const model = (time, storage = memory()) => new ShopClosing({ now: () => time, storage });
function reachChoice(shop, start) {
  shop.enter(start);
  assert.equal(shop.tick(start, {inside:true,visible:true}).warningNew,true);
  return shop.tick(start+8000,{inside:true,visible:true});
}

test('the owner speaks once at 7:59 and hiding appears only after visible hesitation', () => {
  const start=oct('19:58:59'), shop=model(start);
  shop.enter(start);
  assert.equal(shop.tick(start,{inside:true,visible:true}).state,'open');
  const warning=shop.tick(start+1000,{inside:true,visible:true});
  assert.equal(warning.state,'warning');assert.equal(warning.warningNew,true);
  assert.equal(warning.ownerLine,'We are closing now. Anyone still back there?');assert.equal(warning.ownerLine,OWNER_LINE);
  assert.equal(warning.canLeave,true);assert.equal(warning.canHide,false);
  assert.equal(shop.chooseHide(start+1000).state,'warning');
  const waiting=shop.tick(start+8999,{inside:true,visible:true});
  assert.equal(waiting.state,'warning');assert.equal(waiting.warningNew,false);
  const choice=shop.tick(start+9000,{inside:true,visible:true});
  assert.equal(choice.state,'choice');assert.equal(choice.canHide,true);
  assert.equal(shop.tick(start+30000,{inside:true,visible:true}).warningNew,false);
});

test('time in a hidden tab never makes the hide choice appear', () => {
  const start=oct('19:59:00'),shop=model(start);
  shop.enter(start);shop.tick(start,{inside:true,visible:true});
  shop.tick(start+2000,{inside:true,visible:true});
  shop.tick(start+2000,{inside:true,visible:false});
  assert.equal(shop.tick(start+360000,{inside:true,visible:false}).waitMs,2000);
  assert.equal(shop.tick(start+361000,{inside:true,visible:true}).state,'warning');
  assert.equal(shop.tick(start+366999,{inside:true,visible:true}).state,'warning');
  assert.equal(shop.tick(start+367000,{inside:true,visible:true}).state,'choice');
});

test('lights switch at 8 even if no hide choice is made, without choosing for the visitor', () => {
  const start=oct('19:59:00'),shop=model(start);
  reachChoice(shop,start);
  assert.equal(shop.tick(oct('19:59:59'),{inside:true,visible:true}).lightsOff,false);
  const closed=shop.tick(oct('20:00:00'),{inside:true,visible:true});
  assert.equal(closed.closed,true);assert.equal(closed.lightsOff,true);
  assert.equal(closed.state,'choice');assert.equal(closed.resumeHidden,false);assert.equal(closed.canHide,true);
});

test('hiding waits for actual arrival, then a few moments and closing time', () => {
  const start=oct('19:59:00'),shop=model(start);
  reachChoice(shop,start);
  assert.equal(shop.chooseHide(start+8000).state,'hiding');
  assert.equal(shop.tick(start+12000,{inside:true,visible:true}).state,'hiding');
  assert.equal(shop.confirmHidden(start+13000).state,'hidden');
  assert.equal(shop.tick(start+19000,{inside:true,visible:true}).state,'hidden');
  assert.equal(shop.tick(oct('20:00:00'),{inside:true,visible:true}).state,'dark');
  const late=model(oct('20:01:00'));
  late.tick(oct('20:01:00'),{inside:true,visible:true});
  late.tick(oct('20:01:08'),{inside:true,visible:true});late.chooseHide(oct('20:01:08'));late.confirmHidden(oct('20:01:12'));
  assert.equal(late.tick(oct('20:01:17.999'),{inside:true,visible:true}).state,'hidden');
  assert.equal(late.tick(oct('20:01:18'),{inside:true,visible:true}).state,'dark');
});

test('a missed warning is delivered on return, never while the visitor is away', () => {
  const start=oct('19:58:00'),shop=model(start);
  shop.enter(start);shop.tick(start,{inside:true,visible:true});
  assert.equal(shop.tick(oct('19:59:00'),{inside:true,visible:false}).warningNew,false);
  const late=shop.tick(oct('20:05:00'),{inside:true,visible:true});
  assert.equal(late.warningNew,true);assert.equal(late.canHide,false);assert.equal(late.closed,true);
  assert.equal(shop.tick(oct('20:05:08'),{inside:true,visible:true}).canHide,true);
});

test('new arrivals cannot enter after closing; leaving remains available and is persisted', () => {
  const storage=memory(),closedAt=oct('20:00:00'),fresh=model(closedAt,storage);
  assert.equal(fresh.tick(closedAt,{inside:false,visible:true}).canEnter,false);
  assert.equal(fresh.enter(closedAt).canEnter,false);assert.equal(fresh.inside,false);
  const start=oct('19:59:00'),shop=model(start,storage);
  shop.enter(start);shop.tick(start,{inside:true,visible:true});
  assert.equal(shop.chooseLeave(start+3000).state,'leaving');
  assert.equal(shop.confirmLeave(start+5000).state,'outside');
  const restored=model(closedAt,storage).tick(closedAt,{inside:false,visible:true});
  assert.equal(restored.state,'outside');assert.equal(restored.canEnter,false);assert.equal(restored.resumeHidden,false);
});

test('a confirmed hiding place resumes across refresh and midnight, then resets at opening', () => {
  const storage=memory(),start=oct('19:59:00'),shop=model(start,storage);
  reachChoice(shop,start);shop.chooseHide(start+8000);shop.confirmHidden(start+10000);
  const late=oct('23:59:00'),restored=model(late,storage);
  let snapshot=restored.tick(late,{inside:false,visible:true});
  assert.equal(snapshot.state,'dark');assert.equal(snapshot.resumeHidden,true);assert.equal(snapshot.canEnter,true);
  snapshot=restored.tick(oct('00:01:00','23'),{inside:true,visible:true});
  assert.equal(snapshot.cycleKey,'2026-10-22');assert.equal(snapshot.state,'dark');assert.equal(snapshot.closed,true);
  snapshot=restored.tick(oct('08:59:59','23'),{inside:true,visible:true});assert.equal(snapshot.state,'dark');
  snapshot=restored.tick(oct('09:00:00','23'),{inside:true,visible:true});
  assert.equal(snapshot.cycleKey,'2026-10-23');assert.equal(snapshot.state,'open');assert.equal(snapshot.closed,false);assert.equal(snapshot.resumeHidden,false);
});

test('an interrupted hiding route never becomes a completed hide after refresh', () => {
  const storage=memory(),start=oct('19:59:00'),shop=model(start,storage);
  reachChoice(shop,start);shop.chooseHide(start+8000);
  let restored=model(oct('20:00:00'),storage).tick(oct('20:00:00'),{inside:false,visible:true});
  assert.equal(restored.state,'choice');assert.equal(restored.resumeHidden,false);assert.equal(restored.canEnter,false);
  shop.cancelHide(start+10000);assert.equal(shop.state,'choice');
  shop.chooseHide(start+11000);shop.chooseLeave(start+12000);
  restored=model(oct('20:00:00'),storage).tick(oct('20:00:00'),{inside:false,visible:true});
  assert.equal(restored.state,'outside');assert.equal(restored.resumeHidden,false);
});

test('stale or malformed stored data cannot grant a new after-hours entry', () => {
  for(const value of ['not json', JSON.stringify({version:1,cycleKey:'2026-10-21',state:'dark',hiddenAt:oct('20:00:00','21')}), JSON.stringify({version:1,cycleKey:'2026-10-22',state:'dark',hiddenAt:null})]) {
    const storage=memory();storage.setItem(CLOSING_STORAGE_KEY,value);
    const shop=model(oct('20:00:00'),storage),snapshot=shop.tick(oct('20:00:00'),{inside:false,visible:true});
    assert.equal(snapshot.canEnter,false);assert.equal(snapshot.resumeHidden,false);
  }
});

test('opening cycles survive both daylight-saving changes and do not depend on host timezone', () => {
  for(const [before,after,cycle] of [
    ['2026-03-08T01:59:00-05:00','2026-03-08T03:01:00-04:00','2026-03-07'],
    ['2026-11-01T01:59:00-04:00','2026-11-01T01:01:00-05:00','2026-10-31'],
  ]) {
    const shop=model(ms(before));
    assert.equal(shop.tick(ms(before),{inside:false,visible:true}).cycleKey,cycle);
    assert.equal(shop.tick(ms(after),{inside:false,visible:true}).cycleKey,cycle);
    assert.equal(shop.snapshot().closed,true);
  }
});

test('unavailable storage does not prevent warning, choice, or leaving', () => {
  const storage={getItem(){throw new Error('unavailable');},setItem(){throw new Error('unavailable');}};
  const start=oct('19:59:00'),shop=model(start,storage);
  assert.equal(reachChoice(shop,start).canHide,true);assert.equal(shop.snapshot().canSave,false);
  assert.equal(shop.chooseLeave(start+9000).state,'leaving');assert.equal(shop.confirmLeave(start+10000).state,'outside');
  assert.throws(()=>shop.tick(NaN),TypeError);
});
