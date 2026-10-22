import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as THREE from '../dist/vendor/three.module.js';
import { CENTER_SHELF, WALK_CLEARANCE, ROOM_POSES, planRoomPath, sampleRoomPath } from '../dist/room-path.js';
import { curiosities } from '../dist/curiosities.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} should equal ${b}`);
const poses = { ...ROOM_POSES, ...Object.fromEntries(curiosities.map(c => [c.id, c.pose])) };
const pointDistance = (a, b) => Math.hypot(...a.map((value, i) => value - b[i]));
function shelfDistance(point) {
  return Math.hypot(Math.max(CENTER_SHELF.minX - point[0], 0, point[0] - CENTER_SHELF.maxX),
    Math.max(CENTER_SHELF.minZ - point[2], 0, point[2] - CENTER_SHELF.maxZ));
}

test('every real destination pair keeps the visitor and walking sway clear of the shelf', () => {
  assert.ok(curiosities.filter(c => c.shelf).length >= 6, 'Check both sides of all new shelf bays');
  for (const [fromName, [from]] of Object.entries(poses)) {
    for (const [toName, [to]] of Object.entries(poses)) {
      const path = planRoomPath(from, to);
      assert.deepEqual(sampleRoomPath(path, 0), from);
      assert.deepEqual(sampleRoomPath(path, 1), to);
      let length = 0;
      for (let i = 1; i < path.points.length; i++) length += pointDistance(path.points[i - 1], path.points[i]);
      near(path.length, length);
      for (let i = 0; i <= 200; i++) {
        const point = sampleRoomPath(path, i / 200);
        assert.ok(point.every(Number.isFinite));
        assert.ok(point[1] >= Math.min(from[1], to[1]) - 1e-8 && point[1] <= Math.max(from[1], to[1]) + 1e-8);
        assert.ok(shelfDistance(point) >= WALK_CLEARANCE - 1e-8, `${fromName} → ${toName}: shelf collision`);
        for (const sway of [-.012, .012]) {
          assert.ok(shelfDistance([point[0] + sway, point[1], point[2]]) >= .30 - 1e-8,
            `${fromName} → ${toName}: walking sway loses clearance`);
        }
      }
    }
  }
});

test('opposite shelf sides take the shortest end route while clear paths stay straight', () => {
  const x = CENTER_SHELF.maxX + WALK_CLEARANCE, back = CENTER_SHELF.minZ - WALK_CLEARANCE;
  const from = [-1.1, 1.6, 0], to = [1.1, 1.6, 0];
  const path = planRoomPath(from, to);
  near(path.length, 2 * Math.hypot(1.1 - x, back) + 2 * x);
  assert.ok(path.points.slice(1, -1).every(point => point[2] === back));
  const direct = planRoomPath([1.1, 1.6, 3], [1.1, 1.8, -3]);
  assert.equal(direct.points.length, 2);
  near(direct.length, Math.hypot(6, .2));
  const entrance = planRoomPath(ROOM_POSES.entrance[0], ROOM_POSES.table[0]);
  assert.ok(entrance.points.length > 2, 'The entrance-to-book route must go around the shelf');
  assert.ok(entrance.length > pointDistance(ROOM_POSES.entrance[0], ROOM_POSES.table[0]));
});

test('the entry stop frames all three facing shelf bays above the caption on desktop and phone', () => {
  for (const [width, height, fov, bottom] of [[1440, 900, 52, .69], [390, 844, 58, .57]]) {
    const camera = new THREE.PerspectiveCamera(fov, width / height, .04, 60);
    camera.position.fromArray(ROOM_POSES.aisle[0]);
    camera.lookAt(new THREE.Vector3(...ROOM_POSES.aisle[1]));
    camera.updateMatrixWorld();
    const facing = curiosities.filter(c => c.shelf && c.side === 1);
    assert.equal(facing.length, 3);
    for (const curiosity of facing) {
      const point = new THREE.Vector3(...curiosity.position).project(camera);
      const y = (-point.y * .5 + .5) * height;
      assert.ok(point.z > -1 && point.z < 1 && Math.abs(point.x) < .84 && y > 112 && y < height * bottom,
        `${width}px: ${curiosity.name} must face the visitor within the discovery area`);
    }
  }
});

test('sampling uses total route length, with continuous height and exact endpoints', () => {
  const path = planRoomPath([-1.1, 1.5, 2], [1.1, 1.8, 2]);
  for (let i = 0; i < path.points.length; i++) {
    const progress = path.lengths[i] / path.length;
    assert.ok(pointDistance(sampleRoomPath(path, progress), path.points[i]) < 1e-8);
    near(sampleRoomPath(path, progress)[1], 1.5 + .3 * progress);
  }
  const target = [0, 0, 0];
  assert.equal(sampleRoomPath(path, .5, target), target, 'Reuse the frame scratch position');
  assert.deepEqual(sampleRoomPath(path, -1), path.points[0]);
  assert.deepEqual(sampleRoomPath(path, 2), path.points.at(-1));
  const vertical = planRoomPath([1.1, 1.5, 2], [1.1, 1.8, 2]);
  near(vertical.length, .3);
  near(sampleRoomPath(vertical, .5)[1], 1.65);
  const still = planRoomPath([1.1, 1.5, 2], [1.1, 1.5, 2]);
  assert.equal(still.length, 0);
  assert.deepEqual(sampleRoomPath(still, .5), [1.1, 1.5, 2]);
});

test('replanning from an interrupted route or an exact corner keeps every new path clear', () => {
  const path = planRoomPath(ROOM_POSES.entrance[0], ROOM_POSES.table[0]);
  const starts = [...path.points, ...[.15, .45, .75].map(t => sampleRoomPath(path, t))];
  for (const from of starts) for (const [to] of Object.values(poses)) {
    const rerouted = planRoomPath(from, to);
    for (let i = 0; i <= 100; i++) assert.ok(shelfDistance(sampleRoomPath(rerouted, i / 100)) >= WALK_CLEARANCE - 1e-8);
  }
  assert.throws(() => planRoomPath([0, 1.6, 1.6], ROOM_POSES.table[0]), /shelf clearance/);
  assert.throws(() => planRoomPath(ROOM_POSES.table[0], [.5, 1.6, 1.6]), /shelf clearance/);
  assert.throws(() => planRoomPath([NaN, 1.6, 6], ROOM_POSES.table[0]), /finite/);
  assert.throws(() => planRoomPath(ROOM_POSES.entrance[0], ROOM_POSES.table[0], { clearance: -1 }), /clearance/);
});

// Exercise the real app movement functions with only their browser dependencies
// stubbed. This catches callback regressions that would strand openBook's wait.
const appSource = await readFile(new URL('../dist/app.js', import.meta.url), 'utf8');
function movementHarness() {
  const audio = { stopFootsteps() {}, setPosition() {} };
  const context = vm.createContext({ THREE, poses, planRoomPath, performance: { now: () => 1000 },
    roomLook: { reset() {} }, audio, pose: new THREE.Vector3(...ROOM_POSES.entrance[0]),
    focus: new THREE.Vector3(...ROOM_POSES.entrance[1]), move: null, busy: false,
    gentle: false, simple: false, renderReady: true, stopPageTurn() {}, applyComfort() {} });
  const start = appSource.indexOf('function finishMove(){'), end = appSource.indexOf('function closePanels()', start);
  assert.ok(start > 0 && end > start);
  vm.runInContext(appSource.slice(start, end), context);
  const gentle = appSource.match(/^function setGentle\(value\)\{.*\}$/m);
  assert.ok(gentle);
  vm.runInContext(gentle[0], context);
  return context;
}

test('actual app arrival, interruption and reduced motion resolve book waits exactly once', async () => {
  const context = movementHarness();
  context.glide('table');
  assert.ok(context.move.path.points.length > 2);
  near(context.move.distance, context.move.path.length);
  near(context.move.duration, Math.min(6800, Math.max(2100, context.move.path.length * 930)));
  let completions = 0;
  const arrived = new Promise(resolve => { context.move.onArrive = value => { completions++; resolve(value); }; });
  context.finishMove();context.finishMove();
  assert.equal(await arrived, true);
  assert.equal(completions, 1);
  assert.deepEqual(context.pose.toArray(), ROOM_POSES.table[0]);
  assert.equal(context.busy, false);
  context.glide('chair');
  const interrupted = new Promise(resolve => { context.move.onArrive = resolve; });
  context.glide('entrance');
  assert.equal(await interrupted, false);
  const reduced = new Promise(resolve => { context.move.onArrive = resolve; });
  context.setGentle(true);
  assert.equal(await reduced, true);
  assert.equal(context.move, null);
  assert.deepEqual(context.pose.toArray(), ROOM_POSES.entrance[0]);
  context.glide('table');
  assert.equal(context.move, null, 'Reduced motion changes stops without an animated path');
  assert.deepEqual(context.pose.toArray(), ROOM_POSES.table[0]);
  context.gentle = false;context.simple = true;context.glide('chair');
  assert.equal(context.move, null);
  assert.deepEqual(context.pose.toArray(), ROOM_POSES.chair[0]);
});
