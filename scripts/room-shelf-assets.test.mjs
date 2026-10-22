import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import vm from 'node:vm';
import { curiosities } from '../dist/curiosities.js';
import { CENTER_SHELF, ROOM_POSES } from '../dist/room-path.js';
import { shelfFraming, shelfItemAtHit } from '../dist/shelf-navigation.js';

const threeURL = new URL('../dist/vendor/three.module.js', import.meta.url).href;
registerHooks({ resolve(specifier, context, nextResolve) {
  return specifier === 'three' ? { url: threeURL, shortCircuit: true } : nextResolve(specifier, context);
} });
const THREE = await import(threeURL);
const { GLTFLoader } = await import('../dist/vendor/loaders/GLTFLoader.js');
const layout = JSON.parse(await readFile(new URL('../dist/assets/rabbit-hole-layout.json', import.meta.url), 'utf8'));
const items = curiosities.filter(item => item.shelf).map(item => ({ ...item,
  ...layout.items.find(display => display.id === item.id) }));
// The same free image areas used by the responsive card/footer layout. Include
// the joystick's horizontal clearance in landscape and top/bottom safe areas.
const inspectionViewports = [
  { width: 1440, height: 900, top: 134, bottom: 814, left: 20, right: 1064, cardTop: 132, cardLeft: 1084, footerTop: 826 },
  { width: 390, height: 844, top: 157, bottom: 320, left: 20, right: 370, cardTop: 340, cardLeft: 12, footerTop: 728 },
  { width: 320, height: 568, top: 110, bottom: 220, left: 20, right: 300, cardTop: 240, cardLeft: 12, footerTop: 486 },
  { width: 768, height: 1024, top: 142, bottom: 480, left: 20, right: 748, cardTop: 500, cardLeft: 64, footerTop: 930 },
  { width: 1024, height: 768, top: 154, bottom: 662, left: 162, right: 648, cardTop: 152, cardLeft: 668, footerTop: 674 },
  { width: 844, height: 390, top: 118, bottom: 296, left: 163, right: 468, cardTop: 101, cardLeft: 488, footerTop: 308 },
  { width: 844, height: 390, top: 118, bottom: 296, left: 134, right: 437, cardTop: 101, cardLeft: 457, footerTop: 308 },
  { width: 960, height: 600, top: 154, bottom: 494, left: 162, right: 584, cardTop: 152, cardLeft: 604, footerTop: 506 },
];

function corners(bounds) {
  return Array.from({ length: 8 }, (_, corner) => new THREE.Vector3(
    ...[0, 1, 2].map(axis => bounds[(corner >> axis) & 1][axis])));
}
function makeCamera(item, viewport = inspectionViewports[0]) {
  const framing = shelfFraming(item, viewport);
  assert.ok(Number.isFinite(framing.fov), `${item.id}: finite fitted field of view`);
  const camera = new THREE.PerspectiveCamera(framing.fov, viewport.width / viewport.height, .04, 60);
  camera.position.fromArray(item.pose[0]);
  camera.lookAt(new THREE.Vector3(...item.pose[1]));
  camera.setViewOffset(viewport.width, viewport.height, framing.offsetX, framing.offsetY, viewport.width, viewport.height);
  camera.updateMatrixWorld();
  return { camera, framing };
}

// Use real exported geometry and binary chunks. Only image allocation is
// stubbed because these checks inspect triangles and rays, not GPU pixels.
let actualRoomPromise;
async function loadActualRoom() {
  const roomURL = new URL('../dist/assets/bookstore-depth.gltf', import.meta.url);
  const oldFetch = globalThis.fetch, oldSelf = globalThis.self, oldProgressEvent = globalThis.ProgressEvent;
  const oldLoad = THREE.TextureLoader.prototype.load;
  globalThis.self = { URL };
  globalThis.ProgressEvent ??= class extends Event { constructor(type, options = {}) { super(type);Object.assign(this, options); } };
  globalThis.fetch = async (input, options) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.protocol !== 'file:' || !url.pathname.endsWith('.bin')) return oldFetch(input, options);
    const bytes = await readFile(url);
    return new Response(bytes, { status: 200, headers: { 'Content-Length': String(bytes.byteLength) } });
  };
  THREE.TextureLoader.prototype.load = function(_url, onLoad) {
    const texture = new THREE.Texture({ width: 1, height: 1 });
    queueMicrotask(() => onLoad(texture));
    return texture;
  };
  try {
    const source = await readFile(roomURL, 'utf8');
    const gltf = await new GLTFLoader().parseAsync(source, new URL('.', roomURL).href);
    gltf.scene.updateMatrixWorld(true);
    return gltf.scene;
  } finally {
    globalThis.fetch = oldFetch;
    THREE.TextureLoader.prototype.load = oldLoad;
    if (oldSelf === undefined) delete globalThis.self; else globalThis.self = oldSelf;
    if (oldProgressEvent === undefined) delete globalThis.ProgressEvent; else globalThis.ProgressEvent = oldProgressEvent;
  }
}

test('the final measured display layout agrees with the catalog and the solid shelf footprint', () => {
  assert.equal(layout.measured, true, 'Publication must use measured native bounds, not planning placeholders');
  assert.equal(layout.items.length, 20);
  assert.equal(new Set(layout.items.map(item => item.id)).size, 20);
  assert.equal(items.length, 20);
  for (const item of items) {
    const catalog = curiosities.find(c => c.id === item.id);
    assert.deepEqual(item.pose, catalog.pose, `${item.id}: geometry and navigation stops agree`);
    assert.deepEqual(item.position, catalog.position, `${item.id}: geometry and label targets agree`);
    assert.equal(item.side, catalog.side);
    for (const key of ['pickBounds', 'labelBounds']) {
      assert.ok(Array.isArray(item[key]) && item[key].length === 2, `${item.id}: missing ${key}`);
      const [low, high] = item[key];
      assert.equal(low.length, 3);assert.equal(high.length, 3);
      for (let axis = 0; axis < 3; axis++) {
        assert.ok(Number.isFinite(low[axis]) && Number.isFinite(high[axis]) && low[axis] < high[axis], `${item.id}: invalid ${key}`);
      }
      assert.ok(low[0] >= CENTER_SHELF.minX - .001 && high[0] <= CENTER_SHELF.maxX + .001,
        `${item.id}: ${key} protrudes into a traversable aisle`);
      assert.ok(low[2] >= CENTER_SHELF.minZ - .001 && high[2] <= CENTER_SHELF.maxZ + .001,
        `${item.id}: ${key} extends beyond the planned end route`);
    }
  }
});

test('all twenty actual objects and plaques fit above or beside the card on desktop, tablet and phone', () => {
  for (const viewport of inspectionViewports) {
    for (const item of items) {
      const { camera, framing } = makeCamera(item, viewport);
      assert.equal(framing.bottom, viewport.bottom, 'The fit must not enlarge the free band under the card');
      for (const corner of [...corners(item.pickBounds), ...corners(item.labelBounds)]) {
        const point = corner.project(camera);
        const x = (point.x * .5 + .5) * viewport.width, y = (-point.y * .5 + .5) * viewport.height;
        assert.ok(point.z > -1 && point.z < 1, `${item.id}: object is in front of the camera`);
        assert.ok(x > (viewport.left || 20) && x < (viewport.right || viewport.width - 20), `${viewport.width}px ${item.id}: horizontal clipping`);
        assert.ok(y > viewport.top && y < viewport.bottom, `${viewport.width}px ${item.id}: card/header overlap`);
      }
    }
  }
});

test('every exported object and its plaque are selectable from the head-on stop through the nearest real triangle', async () => {
  const room = await (actualRoomPromise ??= loadActualRoom());
  assert.ok(room.getObjectByName('CenterCuriosityShelf'), 'Test the published shelf mesh');
  const ray = new THREE.Raycaster(), selectionEvidence = [];
  for (const item of items) {
    const { camera } = makeCamera(item);
    const visible = corners(item.pickBounds).map(point => point.project(camera));
    const minimum = [Math.min(...visible.map(p => p.x)), Math.min(...visible.map(p => p.y))];
    const maximum = [Math.max(...visible.map(p => p.x)), Math.max(...visible.map(p => p.y))];
    const seen = new Set();let matched = false, tries = 0;
    // Ring-shaped and articulated objects may have empty centers. Search their
    // projected silhouette, then stop as soon as a true visible surface is hit.
    for (const divisions of [2, 4, 8]) {
      for (let x = 1; x < divisions * 2 && !matched; x++) {
        for (let y = 1; y < divisions * 2 && !matched; y++) {
          const u = x / (divisions * 2), v = y / (divisions * 2), key = `${u}:${v}`;
          if (seen.has(key)) continue;seen.add(key);tries++;
          const ndc = new THREE.Vector2(minimum[0] + (maximum[0] - minimum[0]) * u, minimum[1] + (maximum[1] - minimum[1]) * v);
          ray.setFromCamera(ndc, camera);
          const hit = ray.intersectObject(room, true)[0];
          matched = !!hit && hit.point.toArray().every((value, axis) => value >= item.pickBounds[0][axis] - 1e-5 && value <= item.pickBounds[1][axis] + 1e-5) &&
            shelfItemAtHit(items, hit.point.toArray(), camera.position.x)?.id === item.id;
        }
      }
      if (matched) break;
    }
    assert.ok(matched, `${item.id}: no nearest visible triangle selects the correct object from its head-on stop`);
    const [low, high] = item.labelBounds;
    const label = new THREE.Vector3((low[0] + high[0]) / 2, (low[1] + high[1]) / 2, (low[2] + high[2]) / 2).project(camera);
    ray.setFromCamera(new THREE.Vector2(label.x, label.y), camera);
    const labelHit = ray.intersectObject(room, true)[0];
    assert.ok(labelHit, `${item.id}: plaque has a physical surface`);
    assert.equal(shelfItemAtHit(items, labelHit.point.toArray(), camera.position.x)?.id, item.id,
      `${item.id}: nearest plaque surface selects the same website`);
    selectionEvidence.push({ id: item.id, objectRays: tries, label: true });
  }
  assert.equal(selectionEvidence.length, 20);
});

// The pointer handler now uses the nearest room triangle, so prove that
// surrounding furniture does not intercept the original book's click ray.
test('the original book cover remains the nearest selectable surface from its reading stop', async () => {
  const room = await (actualRoomPromise ??= loadActualRoom());
  const hinge = room.getObjectByName('BookCoverHinge');
  assert.ok(hinge, 'The original moving book cover remains in the export');
  const center = new THREE.Box3().setFromObject(hinge).getCenter(new THREE.Vector3());
  const eye = new THREE.Vector3(...ROOM_POSES.table[0]);
  const ray = new THREE.Raycaster(eye, center.sub(eye).normalize());
  const hit = ray.intersectObject(room, true)[0];
  assert.ok(hit, 'The book ray hits a real room triangle');
  let object = hit.object;
  while (object && object !== hinge) object = object.parent;
  assert.equal(object, hinge, 'The closest surface must belong to the original book cover');
});

test('the real waypoint updater keeps one focused label and limits discovery markers on both faces', async () => {
  const app = await readFile(new URL('../dist/app.js', import.meta.url), 'utf8');
  const start = app.indexOf('function updateWaypoints(){'), end = app.indexOf('function finishMove(){', start);
  assert.ok(start > 0 && end > start);
  function update(camera, viewport, place, inspecting) {
    const buttons = [...curiosities, { id: 'table' }].map(item => ({
      dataset: { place: item.id }, style: {}, attributes: {}, classList: { toggle() {} },
      setAttribute(name, value) { this.attributes[name] = value; },
    }));
    const spots = Object.fromEntries(curiosities.map(item => [item.id, new THREE.Vector3(...item.position)]));
    spots.table = new THREE.Vector3(0, 1.14, -4.92);
    const panel = { hidden: !inspecting, getBoundingClientRect: () => ({
      top: viewport.cardTop, left: viewport.cardLeft,
    }) };
    const context = vm.createContext({
      $: selector => selector === '#waypoints' ? { hidden: false } : selector === '#shelf-panel' ? panel :
        selector === '.shop-footer' ? { getBoundingClientRect: () => ({ top: viewport.footerTop }) } : null,
      $$: () => buttons, curiosities: curiosities.map(c => items.find(item => item.id === c.id) || c), spots, camera, place, innerWidth: viewport.width, innerHeight: viewport.height,
    });
    vm.runInContext(app.slice(start, end), context);context.updateWaypoints();
    return buttons.filter(button => button.attributes['aria-hidden'] === 'false');
  }
  for (const viewport of inspectionViewports) {
    for (const item of items) {
      const { camera } = makeCamera(item, viewport);
      const visible = update(camera, viewport, item.id, true);
      assert.deepEqual(visible.map(button => button.dataset.place), [item.id],
        `${viewport.width}px ${item.id}: exactly the selected object's website label must remain available`);
      assert.equal(visible[0].tabIndex, 0);
      assert.match(visible[0].attributes['aria-label'], /^Open /);
    }
    for (const side of [-1, 1]) {
      const item = items.find(item => item.side === side && item.bay === 2 && item.tier === 1);
      const { camera } = makeCamera(item, viewport);
      const visible = update(camera, viewport, 'aisle', false);
      assert.ok(visible.length <= (viewport.width < 600 ? 2 : 3), 'Nearby markers stay sparse');
      for (const button of visible) {
        const display = curiosities.find(item => item.id === button.dataset.place);
        assert.ok(!display?.shelf || display.side === side, 'The shelf hides labels on its far face');
      }
    }
  }
});
