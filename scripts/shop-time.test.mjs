import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { SHOP_TIME_ZONE, OPENING_HOUR, shopTime, sessionDay, solarDay, solarLight } from '../dist/shop-time.js';

const at = value => new Date(value);

test('clock uses Indiana Eastern with fractional seconds and configured opening hour', () => {
  assert.equal(SHOP_TIME_ZONE, 'America/Indiana/Indianapolis');
  const time = shopTime(at('2026-10-22T17:24:30.500Z'));
  assert.equal(time.dateKey, '2026-10-22');
  assert.equal(time.hour, 13);
  assert.equal(time.minute, 24);
  assert.equal(time.second, 30);
  assert.equal(time.minutes, 804 + 30.5 / 60);
  assert.equal(time.timeLabel, '1:24 PM');
  assert.equal(OPENING_HOUR, 9);
  assert.equal(time.openingHour, 9);
  assert.equal(time.closingHour, 20);
  assert.equal(time.isClosed, false);
  assert.deepEqual(shopTime(at('2026-10-22T17:24:30.500Z').getTime()), time);
});

test('overnight closure and story key persist until the 9 AM reopening', () => {
  for (const value of ['2026-10-23T00:00:00Z', '2026-10-23T04:00:00Z', '2026-10-23T12:59:59.999Z']) {
    assert.equal(shopTime(at(value)).isClosed, true);
    assert.equal(sessionDay(at(value)), '2026-10-22');
  }
  assert.equal(shopTime(at('2026-10-23T13:00:00Z')).isClosed, false);
  assert.equal(sessionDay(at('2026-10-23T13:00:00Z')), '2026-10-23');
  assert.equal(sessionDay(at('2026-03-08T07:00:00Z')), '2026-03-07');
  assert.equal(sessionDay(at('2026-11-01T06:00:00Z')), '2026-10-31');
  assert.equal(sessionDay(at('2026-01-01T06:00:00Z')), '2025-12-31');
});

test('7:59 PM warning and 8 PM closure use Eastern time in both seasons', () => {
  for (const [before, warning, closing] of [
    ['2026-10-22T23:58:59.999Z', '2026-10-22T23:59:00Z', '2026-10-23T00:00:00Z'],
    ['2026-12-22T00:58:59.999Z', '2026-12-22T00:59:00Z', '2026-12-22T01:00:00Z'],
  ]) {
    assert.equal(shopTime(at(before)).isClosingSoon, false);
    assert.equal(shopTime(at(warning)).isClosingSoon, true);
    assert.equal(shopTime(at(warning)).isClosed, false);
    assert.equal(shopTime(at(closing)).isClosingSoon, false);
    assert.equal(shopTime(at(closing)).isClosed, true);
    assert.equal(shopTime(at(closing)).hour, 20);
    assert.equal(shopTime(at(closing).getTime() - 1).isClosingSoon, true);
  }
});

test('spring DST gap and autumn repeated hour follow IANA Indiana rules', () => {
  const springBefore = shopTime(at('2026-03-08T06:59:59Z'));
  const springAfter = shopTime(at('2026-03-08T07:00:00Z'));
  assert.deepEqual([springBefore.hour, springBefore.minute], [1, 59]);
  assert.deepEqual([springAfter.hour, springAfter.minute], [3, 0]);
  const fallBefore = shopTime(at('2026-11-01T05:59:59Z'));
  const fallAfter = shopTime(at('2026-11-01T06:00:00Z'));
  assert.deepEqual([fallBefore.hour, fallBefore.minute], [1, 59]);
  assert.deepEqual([fallAfter.hour, fallAfter.minute], [1, 0]);
  assert.equal(shopTime(at('2026-11-02T01:00:00Z')).hour, 20);
});

test('date keys change at local midnight, not UTC midnight', () => {
  const before = shopTime(at('2026-10-23T03:59:59.999Z'));
  const after = shopTime(at('2026-10-23T04:00:00.000Z'));
  assert.equal(before.dateKey, '2026-10-22');
  assert.equal(before.hour, 23);
  assert.equal(after.dateKey, '2026-10-23');
  assert.equal(after.hour, 0);
  assert.equal(after.timeLabel, '12:00 AM');
});

// Independent US Naval Observatory fixtures, rounded by USNO to one minute.
// Sources, date, location and timezone appear in art/shop-time-sources.md.
test('summer and winter solar events agree with USNO within 90 seconds', () => {
  for (const fixture of [
    {
      now: '2026-06-21T16:00:00Z', dawn: '2026-06-21T09:44:00Z',
      sunrise: '2026-06-21T10:17:00Z', sunset: '2026-06-22T01:16:00Z', dusk: '2026-06-22T01:49:00Z',
    },
    {
      now: '2026-12-21T17:00:00Z', dawn: '2026-12-21T12:32:00Z',
      sunrise: '2026-12-21T13:02:00Z', sunset: '2026-12-21T22:23:00Z', dusk: '2026-12-21T22:54:00Z',
    },
  ]) {
    const actual = solarDay(at(fixture.now));
    for (const event of ['dawn', 'sunrise', 'sunset', 'dusk']) {
      assert.ok(Math.abs(actual[event].getTime() - at(fixture[event]).getTime()) <= 90_000,
        `${fixture.now} ${event}: ${actual[event].toISOString()}`);
    }
    assert.equal(actual.latitude, 39.7684);
    assert.equal(actual.longitude, -86.1581);
  }
});

test('solar events stay tied to the Indiana date and cache cannot be mutated', () => {
  const morning = solarDay(at('2026-06-21T05:00:00Z'));
  const lateNight = solarDay(at('2026-06-22T03:00:00Z'));
  assert.deepEqual(morning, lateNight);
  morning.sunrise.setUTCFullYear(2000);
  assert.equal(solarDay(at('2026-06-21T12:00:00Z')).sunrise.getUTCFullYear(), 2026);
});

test('all 2026 solar events remain ordered and on the correct Indiana date', () => {
  for (let day = 0; day < 365; day += 1) {
    const now = new Date(Date.UTC(2026, 0, 1 + day, 17));
    const { dawn, sunrise, sunset, dusk } = solarDay(now);
    assert.ok(dawn < sunrise && sunrise < sunset && sunset < dusk, now.toISOString());
    for (const event of [dawn, sunrise, sunset, dusk]) {
      assert.equal(shopTime(event).dateKey, shopTime(now).dateKey);
    }
  }
});

test('light weights are smooth, bounded and track day, twilight and night', () => {
  const { dawn, sunrise, sunset, dusk } = solarDay(at('2026-06-21T16:00:00Z'));
  const noon = solarLight(at('2026-06-21T17:47:00Z'));
  const midnight = solarLight(at('2026-06-21T05:47:00Z'));
  assert.equal(noon.daylight, 1);
  assert.equal(noon.night, 0);
  assert.ok(noon.altitude > 0);
  assert.equal(midnight.daylight, 0);
  assert.equal(midnight.night, 1);
  assert.ok(midnight.altitude < 0);
  for (let minute = 0; minute < 1440; minute += 5) {
    const light = solarLight(Date.UTC(2026, 5, 21, 0, minute));
    for (const key of ['daylight', 'twilight', 'night']) {
      assert.ok(Number.isFinite(light[key]) && light[key] >= 0 && light[key] <= 1);
    }
    assert.ok(Math.abs(light.daylight + light.twilight + light.night - 1) < 1e-12);
  }
  for (const event of [dawn, sunrise, sunset, dusk]) {
    const before = solarLight(event.getTime() - 1000);
    const after = solarLight(event.getTime() + 1000);
    assert.ok(Math.abs(before.daylight - after.daylight) < 0.01);
    assert.ok(Math.abs(before.night - after.night) < 0.01);
  }
  const twilight = solarLight((dawn.getTime() + sunrise.getTime()) / 2);
  assert.ok(twilight.twilight > 0.1);
});

test('results do not depend on the host timezone', () => {
  const moduleUrl = new URL('../dist/shop-time.js', import.meta.url).href;
  const script = `import {shopTime,solarDay} from ${JSON.stringify(moduleUrl)};
    console.log(JSON.stringify(['2026-03-08T07:00:00Z','2026-11-01T06:00:00Z','2026-10-23T00:00:00Z']
      .map(value => {const date=new Date(value);return [shopTime(date),solarDay(date)];})));`;
  const results = ['UTC', 'Pacific/Honolulu', 'Asia/Tokyo'].map(TZ => {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, TZ }, encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  });
  assert.deepEqual(results[0], results[1]);
  assert.deepEqual(results[1], results[2]);
});

test('invalid dates are rejected clearly', () => {
  for (const method of [shopTime, solarDay, solarLight]) {
    assert.throws(() => method(new Date(NaN)), RangeError);
    assert.throws(() => method(NaN), RangeError);
    assert.throws(() => method('2026-10-22'), TypeError);
  }
});
