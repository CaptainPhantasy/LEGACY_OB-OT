import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as THREE from '../dist/vendor/three.module.js';
import { curiosities } from '../dist/curiosities.js';
import { shelfNavigation, shelfItemAtHit, shelfFraming } from '../dist/shelf-navigation.js';

test('walking controls visit every object bay by bay on both faces without a dead end', () => {
  const visited = new Set();
  for (const side of [-1, 1]) {
    let current = curiosities.find(item => item.shelf && item.side === side && item.bay === 0 && item.tier === 1);
    let previous = null;
    for (let index = 0; index < 10; index++) {
      assert.ok(current && !visited.has(current.id));
      visited.add(current.id);
      const nav = shelfNavigation(curiosities, current.id);
      assert.equal(nav.index, index);
      assert.equal(nav.count, 10);
      assert.equal(nav.previous?.id || null, previous?.id || null);
      assert.equal(nav.opposite.side, -side);
      assert.equal(nav.opposite.bay, current.bay);
      assert.equal(nav.opposite.tier, current.tier);
      assert.equal(shelfNavigation(curiosities, nav.opposite.id).opposite.id, current.id);
      if (nav.next) assert.ok(nav.next.bay === current.bay || nav.next.bay === current.bay + 1);
      previous = current;current = nav.next;
    }
    assert.equal(current, null, 'The last item does not unexpectedly wrap across the entire aisle');
  }
  assert.equal(visited.size, 20);
  assert.equal(shelfNavigation(curiosities, 'maps'), null);
});

const pickItems = [
  { id: 'west', shelf: true, side: -1, url: 'https://example.org/west',
    pickBounds: [[-.32, 1.2, .5], [-.1, 1.6, .8]], labelBounds: [[-.395, 1.1, .55], [-.385, 1.15, .75]] },
  { id: 'east', shelf: true, side: 1, url: 'https://example.org/east',
    pickBounds: [[.1, 1.2, .5], [.32, 1.6, .8]], labelBounds: [[.385, 1.1, .55], [.395, 1.15, .75]] },
];
test('actual surface selection matches the object and its plaque only on the visible face', () => {
  assert.equal(shelfItemAtHit(pickItems, [-.2, 1.4, .65], -1.1).id, 'west');
  assert.equal(shelfItemAtHit(pickItems, [-.39, 1.12, .65], -1.1).id, 'west');
  assert.equal(shelfItemAtHit(pickItems, [.2, 1.4, .65], 1.1).id, 'east');
  assert.equal(shelfItemAtHit(pickItems, [.2, 1.4, .65], -1.1), null);
  assert.equal(shelfItemAtHit(pickItems, [-.2, .9, .65], -1.1), null, 'The empty shelf below an object is not its click target');
  assert.equal(shelfItemAtHit(pickItems, [-.2, 1.4, .65], 0), null);
  assert.equal(shelfItemAtHit(pickItems, [NaN, 1.4, .65], -1.1), null);
});

const app = await readFile(new URL('../dist/app.js', import.meta.url), 'utf8');
test('the app picks the nearest visible triangle, inspects once, then opens the paired website', () => {
  let handler, hits = [], went = [], opened = [], bookOpened = 0;
  const hinge = { parent: null };
  const context = vm.createContext({
    $: () => ({ addEventListener: (_, callback) => { handler = callback; } }),
    THREE: { Vector2: THREE.Vector2, Raycaster: class {
      setFromCamera() {} intersectObject() { return hits; }
    } },
    dragging: true, dragPointer: 4, pointerTravel: 0, room: {}, busy: false,
    place: 'aisle', camera: { position: { x: -1.1 } }, innerWidth: 1000, innerHeight: 800,
    curiosities: pickItems, shelfItemAtHit, hinge,
    go: id => went.push(id), openCuriosityWebsite: item => opened.push(item.url), openBook: () => { bookOpened++; },
  });
  const start = app.indexOf("$('#world').addEventListener('pointerup',e=>{");
  const end = app.indexOf('const stopLooking=', start);
  assert.ok(start > 0 && end > start);
  vm.runInContext(app.slice(start, end), context);
  const event = { pointerId: 4, clientX: 500, clientY: 400 };
  const reset = () => { context.dragging = true;context.dragPointer = 4; };
  hits = [{ point: new THREE.Vector3(-1, 1, .65), object: {} }, { point: new THREE.Vector3(-.2, 1.4, .65), object: {} }];
  handler(event);assert.deepEqual(went, [], 'An intervening scene surface blocks selection');
  reset();hits = [{ point: new THREE.Vector3(-.2, 1.4, .65), object: {} }];
  handler(event);assert.deepEqual(went, ['west']);assert.deepEqual(opened, []);
  reset();context.place = 'west';handler(event);assert.deepEqual(opened, ['https://example.org/west']);
  reset();context.pointerTravel = 12;handler(event);assert.equal(opened.length, 1, 'Looking around must not accidentally open a site');
  reset();context.pointerTravel = 0;context.place = 'table';hits = [{ point: new THREE.Vector3(0, 1, -5), object: { parent: hinge } }];
  handler(event);assert.equal(bookOpened, 1, 'The original book remains selectable');
});

test('fitting respects the actual free screen area and never expands it under the card', () => {
  const item = { pose: [[-1.1, 1.48, 1.5], [-.205, 1.34, 1.5]],
    pickBounds: [[-.35, 1.18, 1.27], [-.06, 1.63, 1.73]] };
  for (const viewport of [
    { width: 1440, height: 900, top: 120, bottom: 580 },
    { width: 390, height: 844, top: 110, bottom: 480 },
    { width: 320, height: 568, top: 110, bottom: 240 },
    { width: 844, height: 390, top: 110, bottom: 305, left: 20, right: 468 },
  ]) {
    const framing = shelfFraming(item, viewport);
    assert.equal(framing.bottom, viewport.bottom);
    const camera = new THREE.PerspectiveCamera(framing.fov, viewport.width / viewport.height, .04, 60);
    camera.position.fromArray(item.pose[0]);camera.lookAt(new THREE.Vector3(...item.pose[1]));
    camera.setViewOffset(viewport.width, viewport.height, framing.offsetX, framing.offsetY, viewport.width, viewport.height);
    camera.updateMatrixWorld();
    for (let corner = 0; corner < 8; corner++) {
      const point = new THREE.Vector3(...[0, 1, 2].map(axis => item.pickBounds[(corner >> axis) & 1][axis])).project(camera);
      const x = (point.x * .5 + .5) * viewport.width, y = (-point.y * .5 + .5) * viewport.height;
      assert.ok(x > (viewport.left || 20) && x < (viewport.right || viewport.width - 20), `${viewport.width}: horizontal clipping`);
      assert.ok(y > viewport.top && y < viewport.bottom, `${viewport.width}: card/header overlap`);
    }
  }
});
