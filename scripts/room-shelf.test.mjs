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
    dragging: true, dragPointer: 4, dragTouch: false, pointerTravel: 0, room: {}, busy: false,
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
  reset();context.busy = true;hits = [{ point: new THREE.Vector3(-.2, 1.4, .65), object: {} }];
  handler(event);assert.deepEqual(went, ['west'], 'A new object can interrupt the current approach');assert.deepEqual(opened, []);context.busy = false;
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
    { width: 390, height: 844, top: 110, bottom: 320 },
    { width: 320, height: 568, top: 110, bottom: 220 },
    { width: 844, height: 390, top: 110, bottom: 296, left: 134, right: 468 },
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

test('app framing keeps every miniature and plaque clear of the footer, joystick and card across touch and desktop layouts', async () => {
  const layout = JSON.parse(await readFile(new URL('../dist/assets/rabbit-hole-layout.json', import.meta.url), 'utf8'));
  const items = curiosities.filter(item => item.shelf).map(item => ({...item,...layout.items.find(measured => measured.id === item.id)}));
  const start = app.indexOf('function updateShelfFraming(){'), end = app.indexOf('function openCuriosityWebsite(', start);
  for (const viewport of [
    // Cards sit above the lower control dock in portrait/tablet layouts. The
    // shortest phone exercises the card's CSS maximum height; landscape phones
    // and tablets use a right-side card. Header bounds conservatively include
    // the top notch/status area; the landscape pair tests either notch side.
    {width:320,height:568,cardTop:240,cardLeft:12,cardRight:308,cardBottom:338,footerTop:486,headerBottom:96,footerHeight:82,stickSize:120,safeBottom:0,safeLeft:0},
    {width:390,height:844,cardTop:340,cardLeft:12,cardRight:378,cardBottom:580,footerTop:728,headerBottom:143,footerHeight:82,stickSize:120,safeBottom:34,safeLeft:0},
    {width:768,height:1024,cardTop:500,cardLeft:64,cardRight:704,cardBottom:770,footerTop:930,headerBottom:128,footerHeight:74,stickSize:132,safeBottom:20,safeLeft:0},
    {width:1024,height:768,cardTop:152,cardLeft:668,cardRight:1008,cardBottom:422,footerTop:674,headerBottom:140,footerHeight:74,stickSize:132,safeBottom:20,safeLeft:0},
    {width:844,height:390,cardTop:101,cardLeft:488,cardRight:828,cardBottom:296,footerTop:308,headerBottom:104,footerHeight:62,stickSize:104,safeBottom:20,safeLeft:47},
    {width:844,height:390,cardTop:101,cardLeft:457,cardRight:797,cardBottom:296,footerTop:308,headerBottom:104,footerHeight:62,stickSize:104,safeBottom:20,safeLeft:0,safeRight:47},
    {width:960,height:600,cardTop:152,cardLeft:604,cardRight:944,cardBottom:422,footerTop:506,headerBottom:140,footerHeight:74,stickSize:132,safeBottom:20,safeLeft:0},
    {width:1440,height:900,cardTop:132,cardLeft:1084,cardRight:1424,cardBottom:402,footerTop:826,headerBottom:120,footerHeight:74,stickSize:0,safeBottom:0,safeLeft:0},
  ]) {
    const landscape=viewport.width>600&&viewport.width>viewport.height;
    const stickLeft=Math.max(18,viewport.safeLeft),stickBottom=viewport.height-viewport.footerHeight-10-viewport.safeBottom;
    const stick=viewport.stickSize?{left:stickLeft,right:stickLeft+viewport.stickSize,top:stickBottom-viewport.stickSize,
      bottom:stickBottom,width:viewport.stickSize}:{left:0,right:0,top:0,bottom:0,width:0};
    const top=viewport.headerBottom+14,right=landscape?viewport.cardLeft-20:viewport.width-20;
    const bottom=landscape?viewport.footerTop-12:viewport.cardTop-20;
    if(stick.width)assert.ok((stick.top+stick.bottom)/2>viewport.height/2,'the movement control is centered in the lower half of the screen');
    assert.equal(viewport.footerTop,viewport.height-viewport.footerHeight-viewport.safeBottom,'footer includes the full bottom safe area');
    assert.ok(stick.bottom<=viewport.footerTop-10,'the stick leaves a clear gap above the clock and sound footer');
    assert.ok(stick.left>=viewport.safeLeft,'the stick clears the left safe area in landscape');
    assert.ok(viewport.cardBottom<=viewport.footerTop-12,'inspection choices stay above the clock and sound footer');
    assert.ok(viewport.cardRight<=viewport.width-(viewport.safeRight||0),'inspection choices clear the right safe area');
    assert.ok(stick.right<viewport.cardLeft||stick.top>viewport.cardBottom,'inspection choices cannot cover the stick');
    for (const item of items) {
      const camera=new THREE.PerspectiveCamera(58,viewport.width/viewport.height,.04,60);
      camera.position.fromArray(item.pose[0]);camera.lookAt(new THREE.Vector3(...item.pose[1]));
      const elements={
        '#shelf-panel':{hidden:false,getBoundingClientRect:()=>({top:viewport.cardTop,left:viewport.cardLeft})},
        '.shop-header':{getBoundingClientRect:()=>({bottom:viewport.headerBottom})},
        '.shop-footer':{getBoundingClientRect:()=>({top:viewport.footerTop})},
        '#walk-stick':{getBoundingClientRect:()=>stick},
      };
      const context=vm.createContext({camera,curiosities:items,place:item.id,$:selector=>elements[selector],shelfFraming,innerWidth:viewport.width,innerHeight:viewport.height});
      vm.runInContext(app.slice(start,end)+'\nupdateShelfFraming();',context);camera.updateMatrixWorld();
      for (const bounds of [item.pickBounds,item.labelBounds]) for(let corner=0;corner<8;corner++){
        const point=new THREE.Vector3(...[0,1,2].map(axis=>bounds[(corner>>axis)&1][axis])).project(camera);
        const x=(point.x*.5+.5)*viewport.width,y=(-point.y*.5+.5)*viewport.height;
        assert.ok(x>20&&x<right,`${item.id} on ${viewport.width}×${viewport.height}: outside horizontal viewing area`);
        assert.ok(y>top&&y<bottom,`${item.id} on ${viewport.width}×${viewport.height}: overlaps header or card (${y.toFixed(1)} outside ${top}–${bottom})`);
        assert.ok(x<stick.left||x>stick.right||y<stick.top||y>stick.bottom,
          `${item.id} on ${viewport.width}×${viewport.height}: hidden behind the stick`);
      }
    }
  }
});
