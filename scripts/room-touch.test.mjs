import test from 'node:test';
import assert from 'node:assert/strict';
import {RoomTouchStick} from '../dist/room-touch.js';
import {RoomMovement} from '../dist/room-movement.js';

const near = (actual, expected, message = '') => assert.ok(
  Math.abs(actual - expected) < 1e-10,
  `${actual} should equal ${expected}. ${message}`
);

test('the stick moves continuously through every direction, at equal half speed', () => {
  const stick = new RoomTouchStick().start(.7);
  for (let degrees = 0; degrees < 360; degrees += 5) {
    const radians = degrees * Math.PI / 180;
    const x = Math.cos(radians), y = Math.sin(radians);
    stick.set(x, y);
    near(stick.x, x);
    near(stick.y, y);
    near(stick.right, x * .5);
    near(stick.forward, -y * .5);
    near(Math.hypot(stick.forward, stick.right), .5);
    near(stick.heading, .7);
  }
});

test('positions outside the rim stay circular and preserve their direction', () => {
  const stick = new RoomTouchStick().start(0);
  for (const [x, y] of [[3, 4], [-4, 3], [0, -9], [Number.MAX_VALUE, Number.MAX_VALUE]]) {
    stick.set(x, y);
    near(Math.hypot(stick.x, stick.y), 1);
    near(Math.hypot(stick.right, stick.forward), .5);
    near(stick.x / stick.y, x / y);
  }
});

test('the center rests still and speed grows smoothly from the dead zone to the rim', () => {
  const stick = new RoomTouchStick().start(0);
  for (const [x, y] of [[0, 0], [.05, .05], [.12, 0], [0, -.12]]) {
    stick.set(x, y);
    assert.equal(stick.forward, 0);
    assert.equal(stick.right, 0);
    assert.equal(stick.turnHeading, null);
  }
  stick.set(.120001, 0);
  assert.ok(stick.right > 0 && stick.right < .000002);
  stick.set(0, -.56);
  near(stick.forward, .25);
  stick.set(.336, -.448);
  near(Math.hypot(stick.forward, stick.right), .25);
  near(stick.right / stick.forward, .75);
});

test('fractional near-center adjustments remain continuous and strictly increase speed', () => {
  const stick = new RoomTouchStick().start(0);
  let previous = 0;
  for (let step = 1; step <= 128; step++) {
    stick.set(.12 + step * .000001, 0);
    assert.ok(stick.right > previous, 'every fractional movement must retain a distinct speed');
    assert.ok(stick.right - previous < .000001, 'tiny inputs must not jump to a minimum walking speed');
    previous = stick.right;
  }
});

test('actual walking distance is half the previous analog response at every tested radius and direction', () => {
  const movement = new RoomMovement({cellSize: .08, sweepFree: () => true});
  const stick = new RoomTouchStick().start(.7), origin = [0, 1.6, 0];
  for (const radius of [.1201, .2, .56, .91, 1]) {
    for (let degrees = 0; degrees < 360; degrees += 30) {
      const angle = degrees * Math.PI / 180, x = Math.cos(angle), y = Math.sin(angle);
      const previousMagnitude = (radius - .12) / .88;
      const previous = movement.step(origin, stick.heading,
        {right: x * previousMagnitude, forward: -y * previousMagnitude}, .1);
      stick.set(x * radius, y * radius);
      const current = movement.step(origin, stick.heading, stick, .1);
      near(current[0], previous[0] * .5);
      near(current[2], previous[2] * .5);
      near(current[1], origin[1]);
    }
  }
});

test('a lower-half crossing requests one fixed half-turn without curving movement', () => {
  const heading = 1.4, stick = new RoomTouchStick().start(heading);
  stick.set(.4, -.4);
  assert.equal(stick.turnHeading, null);
  stick.set(.4, .4);
  near(stick.turnHeading, heading + Math.PI);
  near(stick.heading, heading);
  assert.ok(stick.forward < 0 && stick.right > 0);
  // The consumer clears the event after applying the target to its camera.
  stick.turnHeading = null;
  for (let i = 0; i < 200; i++) {
    stick.set(.4, .4);
    assert.equal(stick.turnHeading, null, 'holding down cannot trigger a repeated spin');
    near(stick.heading, heading, 'movement keeps the original heading');
  }
});

test('equator jitter cannot alternate the view, but a deliberate return turns it forward', () => {
  const stick = new RoomTouchStick().start(-.8);
  for (const y of [.01, -.1, .1, -.02, .12]) {
    stick.set(.8, y);
    assert.equal(stick.turnHeading, null);
  }
  stick.set(-.6, .3);
  near(stick.turnHeading, -.8 - Math.PI);
  stick.turnHeading = null;
  for (const y of [.02, -.02, -.12, .1, 0]) {
    stick.set(.8, y);
    assert.equal(stick.turnHeading, null);
  }
  stick.set(.6, -.3);
  near(stick.turnHeading, -.8);
  stick.turnHeading = null;
  stick.set(0, .8);
  near(stick.turnHeading, -.8 - Math.PI, 'a straight pull keeps its established turning side');
});

test('an unconsumed turn survives later pointer events and centering does not cause a turn', () => {
  const stick = new RoomTouchStick().start(.3).set(.3, .7);
  const requested = stick.turnHeading;
  stick.set(.4, .6).set(0, 0).set(.01, -.01);
  assert.equal(stick.turnHeading, requested);
  assert.equal(stick.forward, 0);
  assert.equal(stick.right, 0);
  stick.turnHeading = null;
  stick.set(0, .6);
  assert.equal(stick.turnHeading, null, 'centering has not rearmed the turn');
});

test('release and reset clear movement and pending turns; each new gesture gets its own anchor', () => {
  const stick = new RoomTouchStick();
  assert.equal(stick.active, false);
  stick.set(1, 1);
  assert.equal(stick.right, 0);
  stick.start(4).set(-.7, .7).end();
  assert.equal(stick.active, false);
  assert.equal(stick.turnHeading, null);
  for (const key of ['x', 'y', 'forward', 'right']) assert.equal(stick[key], 0);
  stick.set(1, -1);
  assert.equal(stick.forward, 0);
  stick.start(-2).set(0, .8);
  near(stick.heading, -2);
  near(stick.turnHeading, -2 + Math.PI);
  stick.reset();
  assert.equal(stick.heading, 0);
  assert.equal(stick.active, false);
  assert.equal(stick.turnHeading, null);
});

test('invalid values cannot introduce non-finite movement or camera targets', () => {
  const stick = new RoomTouchStick().start(0);
  assert.throws(() => stick.start(NaN), TypeError);
  assert.throws(() => stick.set(Infinity, 0), TypeError);
  assert.throws(() => stick.set(0, undefined), TypeError);
  assert.equal(stick.forward, 0);
  assert.equal(stick.right, 0);
});
