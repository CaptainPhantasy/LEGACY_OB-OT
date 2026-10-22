import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as THREE from '../dist/vendor/three.module.js';
import {ShopClosing,OWNER_LINE,CLOSING_STORAGE_KEY} from '../dist/shop-closing.js';
import {shopTime,solarLight} from '../dist/shop-time.js';
import {appendPath,SHOP_HIDE_POSITION} from '../dist/shop-navigation.js';
import {ROOM_POSES,sampleRoomPath} from '../dist/room-path.js';
import {RoomLook} from '../dist/room-look.js';
import {RoomTouchStick} from '../dist/room-touch.js';

const source=await readFile(new URL('../dist/app.js',import.meta.url),'utf8');
const oct=(time,day='22')=>Date.parse(`2026-10-${day}T${time}-04:00`);
const ENTRANCE_THRESHOLD=[0,1.6,6.65],EXIT_POSITION=[0,1.6,9.4];
function section(start,end){
  const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a,`${start} section is present`);return source.slice(a,b);
}
function classes(initial=[]){const values=new Set(initial);return{add(...names){names.forEach(n=>values.add(n));},remove(...names){names.forEach(n=>values.delete(n));},contains(n){return values.has(n);},toggle(n,value){if(value??!values.has(n))values.add(n);else values.delete(n);}};}
function memory(){const data=new Map();return{getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};}
function harness({at=oct('12:00:00'),inside=false,storage=memory(),gentle=false,simple=false}={}){
  let now=at;const elements=new Map(),calls={owner:0,bell:0,reset:0,bookClosed:0,ui:[],focusedLeave:0,dismiss:0,announcements:[],door:[],lights:[],ambientLights:[],storefrontFrames:[],daylightUniforms:[],pipelineFrames:[],render:0,directRender:0};
  const el=id=>{
    if(!elements.has(id))elements.set(id,{id,hidden:false,disabled:false,open:false,innerHTML:`original ${id}`,textContent:'',attrs:{},dataset:{},classList:classes(),
      setAttribute(key,value){this.attrs[key]=value;},focus(){calls.focus=id;}});
    return elements.get(id);
  };
  const shopClosing=new ShopClosing({storage,now:()=>now});if(inside)shopClosing.enter();
  const roomLook=new RoomLook(),touchStick=new RoomTouchStick();
  const pose=new THREE.Vector3(0,1.6,6.6),focus=new THREE.Vector3(0,1.25,-5.4),camera=new THREE.PerspectiveCamera(58,390/844,.04,60);
  camera.position.copy(pose);camera.lookAt(focus);
  const context=vm.createContext({
    THREE,shopClosing,shopTime,solarLight,OWNER_LINE,appendPath,SHOP_HIDE_POSITION,ENTRANCE_THRESHOLD,EXIT_POSITION,ROOM_POSES,sampleRoomPath,
    Date:class extends Date{static now(){return now;}},performance:{now:()=>1000},$:el,$$:()=>[],
    document:{hidden:false,body:{classList:classes(inside?['inside']:[])},title:''},
    shopStatus:shopClosing.snapshot(),solarState:solarLight(now),solarUpdated:now,shopLightLevel:shopClosing.snapshot().lightsOff?0:1,
    darkExploring:false,storyJourney:0,entryPending:false,hasOpened:true,openingToken:0,revealAt:0,
    place:inside?'aisle':'entrance',freeExploring:false,busy:false,move:null,gentle,simple,renderReady:true,
    pose,focus,camera,roomLook,touchStick,walkingKeys:new Set(),dragging:false,dragPointer:null,
    poses:ROOM_POSES,curiosities:[],lookTarget:new THREE.Vector3(),walkPoint:[0,0,0],listenerDirection:new THREE.Vector3(),
    introCopy:{eyebrow:'Original eyebrow',title:'Original title',description:'Original description',note:'Original note'},
    movement:{planPath(from,to){return appendPath({points:[from],lengths:[0],length:0},to);}},
    storefront:{setClosed(value){calls.closed=value;},setDoorOpen(value){calls.door.push(value);},update(value){calls.storefrontFrames.push(value);}},
    closingUI:{update(status,options){calls.ui.push({status,options});},focusLeave(){calls.focusedLeave++;},dismiss(){calls.dismiss++;}},
    audio:{ownerCall(){calls.owner++;},bell(){calls.bell++;},stopFootsteps(){},stopActive(){},step(){},setPosition(){}},
    atmosphere:{close(){calls.atmosphereClosed=true;},setShopLight(level){calls.ambientLights.push(level);},update(){}},
    radiance:{setDaylight(level){calls.daylight=level;return this;},setShopLight(level){calls.lights.push(level);return this;},update(){}},
    roomVisibility:{update(){}},magicLight:{intensity:0},room:{},scene:{},mixer:null,hinge:null,hingeStart:null,openAction:null,closing:null,
    renderer:{shadowMap:{needsUpdate:false},render(){calls.directRender++;}},
    roomRenderer:{render(scene,camera){calls.render++;calls.pipelineFrames.push({scene,camera});}},lastFrame:1000,time:0,qualitySettled:true,
    requestAnimationFrame(){},updateRoomRevelation(){},updateRoomDaylight(room,level){calls.daylightUniforms.push({room,level});},updateWaypoints(){},updateManualMovement(){},
    announce(message){calls.announcements.push(message);},
    closePanels(){for(const id of ['#shelf-panel','#chair-panel','#explore-menu','#settings-panel','#leave-panel'])el(id).hidden=true;},
    closeBook(){el('#book-reader').open=false;calls.bookClosed++;},
    openBook(resume){calls.openBook=resume;},
    setCaption(){},showCuriosity(){},togglePanel(){},
    resetManualInput(){calls.reset++;context.walkingKeys.clear();touchStick.end();roomLook.cancelMotion();context.dragging=false;context.dragPointer=null;},
  });
  vm.runInContext(section('function settleBookForStory(){','function preserveHeading(){'),context);
  vm.runInContext(section('function finishMove(){','function closePanels(){'),context);
  vm.runInContext(section('function go(name){','function focusRoomAfterPointer('),context);
  vm.runInContext(section('function frame(now){','function updateWaypoints(){'),context);
  vm.runInContext(section('function useSimpleView(',"$('#simple-view').onclick"),context);
  return{c:context,el,calls,storage,setNow(value){now=value;},now:()=>now};
}

test('closed entry is enforced by both entry buttons and destination navigation',()=>{
  const{c,el,calls}=harness({at:oct('20:00:00')});c.tickShop();
  assert.equal(c.shopStatus.closed,true);assert.equal(c.place,'outside');assert.deepEqual(c.pose.toArray(),EXIT_POSITION);
  for(const id of ['#enter','#enter-quietly','#resume','#return-shop'])assert.equal(el(id).disabled,true);
  assert.equal(c.enterShop(),false);assert.equal(c.go('table'),false);
  assert.equal(c.document.body.classList.contains('inside'),false);assert.equal(c.move,null);
  assert.equal(calls.bell,0);assert.match(calls.announcements.at(-1),/closed until 9 a.m./);
});

test('leaving crosses the glass-door threshold before arrival and allows daytime re-entry',()=>{
  const h=harness({inside:true}),{c,calls}=h;c.tickShop();
  assert.equal(c.leaveShop(),true);assert.equal(c.shopStatus.state,'leaving');
  assert.equal(c.document.body.classList.contains('inside'),true,'the visitor is inside during the route');
  assert.equal(c.canExplore(),false);assert.equal(c.document.body.classList.contains('story-travel'),true);
  assert.deepEqual(Array.from(c.move.path.points.at(-2)),ENTRANCE_THRESHOLD);assert.deepEqual(Array.from(c.move.path.points.at(-1)),EXIT_POSITION);
  c.finishMove();assert.equal(c.shopStatus.state,'outside');assert.equal(c.document.body.classList.contains('inside'),false);
  assert.equal(c.document.body.classList.contains('story-travel'),false);assert.deepEqual(c.pose.toArray(),EXIT_POSITION);
  assert.deepEqual(calls.door,[true,false]);
  assert.equal(c.enterShop(),true);assert.equal(c.document.body.classList.contains('inside'),false,'return crosses the door before the room activates');
  c.finishMove();assert.equal(c.document.body.classList.contains('inside'),true);assert.equal(c.place,'aisle');
  assert.equal(calls.door.at(-1),false);
});

test('an approach started before closing cannot enter after the closing instant',()=>{
  const h=harness({at:oct('19:59:59')}),{c,el,calls}=h;
  c.place='outside';c.pose.fromArray(EXIT_POSITION);c.document.body.classList.add('outside');c.tickShop();
  assert.equal(c.enterShop('table',true),true);assert.ok(c.move);assert.equal(c.canExplore(),false);
  h.setNow(oct('20:00:02'));c.finishMove();
  assert.equal(c.document.body.classList.contains('inside'),false);assert.equal(c.canExplore(),false);
  assert.ok(c.move,'the blocked arrival queues a return to the sidewalk');
  assert.deepEqual(Array.from(c.move.path.points.at(-1)),EXIT_POSITION);
  assert.equal(calls.openBook,undefined);assert.equal(calls.bell,0);
  c.finishMove();
  assert.equal(c.place,'outside');assert.equal(c.move,null);assert.deepEqual(c.pose.toArray(),EXIT_POSITION);
  assert.equal(c.document.body.classList.contains('story-travel'),false);assert.equal(c.document.body.classList.contains('inside'),false);
  assert.equal(el('#leave-panel').hidden,false);assert.equal(el('#return-shop').disabled,true);assert.equal(calls.door.at(-1),false);
  assert.match(calls.announcements.at(-1),/shop has closed/);
});

test('returning to a backgrounded entry after closing still leaves the visitor outside',()=>{
  const h=harness({at:oct('19:58:00')}),{c,el}=h;
  c.place='outside';c.pose.fromArray(EXIT_POSITION);c.document.body.classList.add('outside');c.tickShop();c.enterShop();
  c.document.hidden=true;c.tickShop();h.setNow(oct('23:00:00'));c.tickShop();
  assert.equal(c.document.body.classList.contains('inside'),false);
  c.document.hidden=false;c.tickShop();c.finishMove();
  assert.equal(c.canExplore(),false);assert.equal(c.document.body.classList.contains('inside'),false);
  c.finishMove();assert.equal(c.place,'outside');assert.equal(c.move,null);assert.equal(el('#return-shop').disabled,true);
});

test('switching to simple view during entry finishes the route without leaving an unrendered journey',()=>{
  for(const closesDuringEntry of [false,true]){
    const h=harness({at:closesDuringEntry?oct('19:59:59'):oct('12:00:00')}),{c}=h;
    c.place='outside';c.pose.fromArray(EXIT_POSITION);c.document.body.classList.add('outside');c.tickShop();c.enterShop();
    if(closesDuringEntry)h.setNow(oct('20:00:02'));
    c.useSimpleView();
    assert.equal(c.simple,true);assert.equal(c.move,null);assert.equal(c.busy,false);
    assert.equal(c.document.body.classList.contains('story-travel'),false);
    assert.equal(c.document.body.classList.contains('inside'),!closesDuringEntry);
    assert.equal(c.place,closesDuringEntry?'outside':'aisle');
    assert.deepEqual(c.pose.toArray(),closesDuringEntry?EXIT_POSITION:ROOM_POSES.aisle[0]);
  }
});

test('the 7:59 call cancels walking, book waiting and the visible reader exactly once',()=>{
  const h=harness({at:oct('19:58:59'),inside:true}),{c,el,calls}=h;c.tickShop();
  const arrivals=[];c.move={onArrive:arrived=>arrivals.push(arrived)};c.busy=true;
  c.walkingKeys.add('KeyW');c.touchStick.start(0).set(0,-1);c.roomLook.faceHeading(Math.PI,c.pose,c.focus);
  el('#book-reader').open=true;c.revealAt=10;c.magicLight.intensity=50;
  h.setNow(oct('19:59:00'));c.tickShop();
  assert.deepEqual(arrivals,[false]);assert.equal(c.move,null);assert.equal(c.busy,false);
  assert.equal(c.walkingKeys.size,0);assert.equal(c.touchStick.active,false);assert.equal(c.roomLook.autoTurn,null);
  assert.equal(calls.bookClosed,1);assert.equal(c.revealAt,0);assert.equal(c.magicLight.intensity,0);
  assert.equal(calls.owner,1);assert.equal(calls.focusedLeave,1);assert.equal(c.shopStatus.canHide,false);
  h.setNow(oct('19:59:01'));c.tickShop();assert.equal(calls.owner,1);assert.deepEqual(arrivals,[false]);
});

test('hiding requires the offered choice and records completion only upon arrival',()=>{
  const h=harness({at:oct('19:59:00'),inside:true}),{c}=h;c.tickShop();
  assert.equal(c.hideInShop(),false);
  h.setNow(oct('19:59:08'));c.tickShop();assert.equal(c.shopStatus.canHide,true);
  assert.equal(c.hideInShop(),true);assert.equal(c.shopStatus.state,'hiding');assert.equal(c.shopStatus.resumeHidden,false);
  assert.equal(c.canExplore(),false);assert.equal(c.go('table'),false);
  c.finishMove();assert.equal(c.shopStatus.state,'hidden');assert.equal(c.shopStatus.resumeHidden,true);
  assert.equal(c.document.body.classList.contains('hide-wait'),true);assert.equal(c.document.body.classList.contains('story-travel'),false);
  assert.deepEqual(c.pose.toArray(),SHOP_HIDE_POSITION);
  h.setNow(oct('20:00:00'));c.tickShop();assert.equal(c.shopStatus.state,'dark');
  c.exploreAfterDark();assert.equal(c.canExplore(),true);assert.equal(c.darkExploring,true);assert.equal(c.place,'free');
  assert.equal(c.document.body.classList.contains('hide-wait'),false);
  assert.equal(c.leaveShop(),true);c.finishMove();assert.equal(c.shopStatus.state,'outside');
});

test('leaving during the hiding approach invalidates the old arrival callback',()=>{
  const h=harness({at:oct('19:59:00'),inside:true}),{c}=h;c.tickShop();h.setNow(oct('19:59:08'));c.tickShop();
  c.hideInShop();const oldArrival=c.move.onArrive;
  assert.equal(c.leaveShop(),true);oldArrival(true);
  assert.equal(c.shopStatus.state,'leaving');assert.equal(c.document.body.classList.contains('hide-wait'),false);
  c.finishMove();assert.equal(c.shopStatus.state,'outside');assert.equal(c.place,'outside');
});

test('a repeated exit click cannot restart an exit that is already underway',()=>{
  const{c}=harness({inside:true});c.tickShop();c.leaveShop();
  const journey=c.move,sequence=c.storyJourney;
  assert.equal(c.leaveShop(),false);assert.equal(c.move,journey);assert.equal(c.storyJourney,sequence);
  c.finishMove();assert.equal(c.shopStatus.state,'outside');
});

test('a failed hiding route leaves the choice available and never records a false hide',()=>{
  const h=harness({at:oct('19:59:00'),inside:true}),{c,calls}=h;c.tickShop();h.setNow(oct('19:59:08'));c.tickShop();
  c.movement.planPath=()=>{throw new Error('blocked');};
  assert.equal(c.hideInShop(),false);assert.equal(c.shopStatus.state,'choice');assert.equal(c.shopStatus.resumeHidden,false);
  assert.equal(c.move,null);assert.equal(c.document.body.classList.contains('story-travel'),false);
  assert.match(calls.announcements.at(-1),/clear aisle/);
});

test('a saved hiding place resumes after midnight and reopens without trapping movement in the morning',()=>{
  const storage=memory();storage.setItem(CLOSING_STORAGE_KEY,JSON.stringify({version:1,cycleKey:'2026-10-22',state:'hidden',hiddenAt:oct('19:59:20'),waitMs:8000}));
  const h=harness({at:oct('00:10:00','23'),storage}),{c,el}=h;c.tickShop();
  assert.equal(c.shopStatus.resumeHidden,true);assert.equal(el('#enter').disabled,false);
  assert.equal(c.enterShop(),true);assert.equal(c.document.body.classList.contains('inside'),true);
  assert.deepEqual(c.pose.toArray(),SHOP_HIDE_POSITION);assert.equal(c.shopStatus.state,'dark');
  c.exploreAfterDark();h.setNow(oct('09:00:00','23'));c.tickShop();
  assert.equal(c.shopStatus.closed,false);assert.equal(c.shopStatus.state,'open');assert.equal(c.canExplore(),true);
  assert.equal(c.darkExploring,false);assert.equal(c.document.body.classList.contains('after-hours'),false);
});

test('closing fades the real lamps while the street keeps the current real time and solar lighting',()=>{
  const h=harness({at:oct('19:59:59'),inside:true}),{c,calls}=h;c.tickShop();
  c.storefront.shadowDirty=true;
  h.setNow(oct('20:00:00'));c.tickShop();c.frame(1050);
  assert.ok(c.shopLightLevel>0&&c.shopLightLevel<1,'normal motion fades rather than snaps the lamps');
  assert.equal(calls.lights.at(-1),c.shopLightLevel);assert.equal(calls.ambientLights.at(-1),c.shopLightLevel);
  assert.equal(calls.storefrontFrames.at(-1).nowMs,h.now());assert.equal(calls.storefrontFrames.at(-1).daylight,c.solarState.daylight);
  assert.deepEqual(calls.storefrontFrames.at(-1).sunDirection,c.solarState.sunDirection);
  assert.equal(c.renderer.shadowMap.needsUpdate,true,'A dirty street shadow is refreshed through the renderer-wide gate');
  const before=c.shopLightLevel;c.frame(1100);assert.ok(c.shopLightLevel<before);
  c.gentle=true;c.frame(1150);assert.equal(c.shopLightLevel,0);
  h.setNow(oct('09:00:00','23'));c.tickShop();c.frame(1200);assert.equal(c.shopLightLevel,1);
  assert.equal(calls.daylight,c.solarState.daylight);
  assert.equal(calls.daylightUniforms.at(-1).level,c.solarState.daylight);
  assert.equal(calls.daylightUniforms.at(-1).room,c.room);
  assert.equal(calls.render,4);assert.equal(calls.directRender,0,'Active frames go through the contact/reflection pipeline');
  assert.ok(calls.pipelineFrames.every(frame=>frame.scene===c.scene&&frame.camera===c.camera));
  c.document.hidden=true;c.frame(1250);assert.equal(calls.render,4,'Backgrounding suspends the complete rendering pipeline');
  c.document.hidden=false;c.simple=true;c.frame(1300);assert.equal(calls.render,4,'Simple view does not continue hidden GPU work');
});

test('solar clock updates feed the same daylight into live lights and the room daylight uniform',()=>{
  const h=harness({at:oct('12:00:00'),inside:true}),{c,calls}=h;c.tickShop();
  assert.equal(calls.daylightUniforms.length,0,'A cached solar state does not need another uniform update');
  h.setNow(oct('12:00:16'));c.tickShop();
  assert.equal(calls.daylightUniforms.length,1);
  assert.equal(calls.daylightUniforms[0].room,c.room);
  assert.equal(calls.daylightUniforms[0].level,solarLight(h.now()).daylight);
  assert.equal(calls.daylight,calls.daylightUniforms[0].level);
  h.setNow(oct('12:00:17'));c.tickShop();assert.equal(calls.daylightUniforms.length,1);
  h.setNow(oct('00:10:00'));c.tickShop();
  assert.equal(calls.daylightUniforms.length,2,'A device clock adjustment also refreshes the solar state');
  assert.equal(calls.daylightUniforms.at(-1).level,0);assert.equal(calls.daylight,0);
});

test('reduced-motion and simple views complete story choices without requiring animated frames',()=>{
  for(const mode of ['gentle','simple']){
    const h=harness({at:oct('19:59:00'),inside:true,[mode]:true}),{c}=h;c.tickShop();h.setNow(oct('19:59:08'));c.tickShop();
    assert.equal(c.hideInShop(),true);assert.equal(c.shopStatus.state,'hidden');assert.equal(c.move,null);
    assert.equal(c.document.body.classList.contains('story-travel'),false);
    assert.equal(c.leaveShop(),true);assert.equal(c.shopStatus.state,'outside');assert.equal(c.move,null);
    assert.equal(c.document.body.classList.contains('inside'),false);
  }
});
