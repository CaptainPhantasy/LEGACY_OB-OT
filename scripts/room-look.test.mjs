import test from 'node:test';
import assert from 'node:assert/strict';
import {Vector3,PerspectiveCamera} from '../dist/vendor/three.module.js';
import {RoomLook} from '../dist/room-look.js';
import {curiosities} from '../dist/curiosities.js';

const degrees=value=>value*180/Math.PI;
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} should equal ${expected}`);
const stops=[
  [[0,1.6,6.6],[0,1.25,-5.4]],
  [[0,1.6,1.6],[0,1.3,-5.1]],
  [[.35,1.82,-3.48],[0,1.06,-4.92]],
  ...curiosities.map(c=>c.pose)
].map(([position,focus])=>({position:new Vector3(...position),focus:new Vector3(...focus)}));
function direction(look,position,focus){
  const camera=new PerspectiveCamera(58,390/844,.04,60);
  camera.position.copy(position);camera.lookAt(look.target(position,focus,new Vector3()));
  return {camera,vector:camera.getWorldDirection(new Vector3())};
}

test('dragging completes repeated full turns in either direction at every stop',()=>{
  for(const {position,focus} of stops){
    const look=new RoomLook(),initial=direction(look,position,focus).vector;
    look.turn(20,0,position,focus);assert.ok(look.yaw<0,'drag right turns toward the left');
    look.reset();
    for(let i=0;i<5;i++){
      look.turn(-2*Math.PI/.0045,0,position,focus);
      near(degrees(look.yaw),360*(i+1));
      assert.ok(direction(look,position,focus).vector.distanceTo(initial)<1e-10,'complete turn returns to the original view');
    }
    look.turn(12*Math.PI/.0045,0,position,focus);
    near(degrees(look.yaw),-360);
    const {camera}=direction(look,position,focus);
    assert.ok(camera.position.equals(position),'looking never moves the visitor');
  }
});

test('looking reaches the ceiling and floor without turning upside down, even beside the book',()=>{
  for(const {position,focus} of stops){
    for(const [drag,angle] of [[100000,89],[-100000,-89]]){
      const look=new RoomLook();look.turn(100000,drag,position,focus);
      const {camera,vector}=direction(look,position,focus);
      near(degrees(Math.asin(vector.y)),angle);
      assert.ok(new Vector3(0,1,0).applyQuaternion(camera.quaternion).y>0,'horizon stays upright');
      const centerRay=new Vector3(0,0,-1).applyQuaternion(camera.quaternion);
      assert.ok(centerRay.distanceTo(vector)<1e-10,'ray picking follows the new view');
    }
  }
});

test('a small reverse drag responds immediately after repeated revolutions and a pitch limit',()=>{
  const {position,focus}=stops[2],look=new RoomLook();
  look.turn(1e6,1e6,position,focus);
  const yaw=look.yaw,pitch=look.pitch;
  look.turn(-1,-1,position,focus);
  assert.ok(look.yaw>yaw);assert.ok(look.pitch<pitch);
});

test('resetting for a chosen destination points directly at that object',()=>{
  for(const {position,focus} of stops){
    const look=new RoomLook();look.turn(-300,200,position,focus);look.reset();
    const {vector}=direction(look,position,focus);
    assert.ok(vector.distanceTo(focus.clone().sub(position).normalize())<1e-10);
  }
});

test('mouse drags retain their original sensitivity and keep the horizon level',()=>{
  const {position,focus}=stops[1],look=new RoomLook();
  look.turn(-150,-100,position,focus);const first=look.yaw;
  look.turn(-150,-100,position,focus);assert.ok(look.yaw>first);
  assert.ok(degrees(look.yaw)>75,'two short phone swipes give a broad view');
  const {camera}=direction(look,position,focus);
  near(new Vector3(1,0,0).applyQuaternion(camera.quaternion).y,0);
});

test('touch looking uses half its previous sensitivity and eases toward the requested view',()=>{
  const {position,focus}=stops[1],mouse=new RoomLook(),touch=new RoomLook();
  mouse.turn(-150,-100,position,focus);touch.turnTouch(-150,-100,position,focus);
  near(mouse.yaw,.675);near(touch.yaw,0);
  touch.update(1/60);
  assert.ok(touch.yaw>0&&touch.yaw<.15,'the first frame moves partway instead of snapping');
  let previous=touch.yaw;
  for(let i=0;i<120;i++){
    touch.update(1/60);
    assert.ok(touch.yaw>=previous&&touch.yaw<=.15,'smoothing never overshoots the requested turn');
    previous=touch.yaw;
  }
  near(touch.yaw,.15);near(touch.pitch,-.1);
  assert.ok(touch.yaw<mouse.yaw/2,'the same swipe turns less than half as far on touch');
  const {camera}=direction(touch,position,focus);
  near(new Vector3(1,0,0).applyQuaternion(camera.quaternion).y,0);
});

test('touch smoothing produces the same view over equal time at 30, 60 and 120 frames per second',()=>{
  const {position,focus}=stops[1];
  const samples=[30,60,120].map(fps=>{
    const look=new RoomLook();look.turnTouch(-250,120,position,focus);
    for(let i=0;i<fps/10;i++)look.update(1/fps);
    return {yaw:look.yaw,pitch:look.pitch};
  });
  for(const sample of samples){near(sample.yaw,samples[0].yaw);near(sample.pitch,samples[0].pitch);}
});

test('touch cancellation stops immediately and starts a new swipe from the visible view',()=>{
  const {position,focus}=stops[1],look=new RoomLook();
  look.turnTouch(-200,100,position,focus);look.update(1/60);
  const before={yaw:look.yaw,pitch:look.pitch};look.stopTouch();
  for(let i=0;i<60;i++)look.update(1/60);
  near(look.yaw,before.yaw);near(look.pitch,before.pitch);
  look.turnTouch(10,-10,position,focus);look.update(1);
  near(look.yaw,before.yaw-.01);near(look.pitch,before.pitch-.01);
});

test('a flick completed between frames settles to its full requested angle within 100 ms without drifting',()=>{
  const {position,focus}=stops[1];
  for(const fps of [30,60,120]){
    const look=new RoomLook();look.turnTouch(-90,45,position,focus);look.releaseTouch();
    near(look.yaw,0);near(look.pitch,0);
    let previous=0;
    for(let frame=0;frame<fps/10;frame++){
      look.update(1/fps);
      assert.ok(look.yaw>=previous&&look.yaw<=.09,'settling must not overshoot');
      previous=look.yaw;
    }
    near(look.yaw,.09);near(look.pitch,.045);
    look.update(3);near(look.yaw,.09);near(look.pitch,.045);
  }
});

test('cancelling during the release settle stops at the visible angle immediately',()=>{
  const {position,focus}=stops[1];
  for(const cancel of ['stopTouch','cancelMotion']){
    const look=new RoomLook();look.turnTouch(-200,100,position,focus);look.releaseTouch();look.update(.03);
    assert.ok(look.yaw>0&&look.yaw<.2);
    const visible={yaw:look.yaw,pitch:look.pitch};look[cancel]();look.update(3);
    near(look.yaw,visible.yaw);near(look.pitch,visible.pitch);
  }
});

test('a new swipe or a requested half-turn replaces release settling from the visible angle',()=>{
  const {position,focus}=stops[1];
  const swipe=new RoomLook();swipe.turnTouch(-200,100,position,focus);swipe.releaseTouch();swipe.update(.03);
  const visible={yaw:swipe.yaw,pitch:swipe.pitch};
  swipe.turnTouch(50,-25,position,focus);near(swipe.yaw,visible.yaw);near(swipe.pitch,visible.pitch);
  swipe.releaseTouch();swipe.update(.1);
  near(swipe.yaw,visible.yaw-.05);near(swipe.pitch,visible.pitch-.025);
  const turn=new RoomLook();turn.turnTouch(-200,100,position,focus);turn.releaseTouch();turn.update(.03);
  const turnStart={yaw:turn.yaw,pitch:turn.pitch},heading=turn.heading(position,focus);
  turn.faceHeading(heading+Math.PI,position,focus);near(turn.yaw,turnStart.yaw);
  turn.update(2.4);near(Math.abs(turn.yaw-turnStart.yaw),Math.PI);near(turn.pitch,turnStart.pitch);
  const settled=turn.yaw;turn.update(3);near(turn.yaw,settled);near(turn.pitch,turnStart.pitch);
});

test('large touch swipes stay upright at both pitch limits at every inspection stop',()=>{
  for(const {position,focus} of stops)for(const sign of [-1,1]){
    const look=new RoomLook();look.turnTouch(200,sign*100000,position,focus);
    for(let i=0;i<120;i++){
      look.update(1/60);
      const {camera,vector}=direction(look,position,focus);
      assert.ok(Math.abs(degrees(Math.asin(vector.y)))<=89+1e-8);
      assert.ok(new Vector3(0,1,0).applyQuaternion(camera.quaternion).y>0);
    }
    near(degrees(look.basePitch(position,focus)+look.pitch),sign*89);
  }
});

test('automatic half-turn takes twice the previous interval, completes once and never overshoots',()=>{
  const {position,focus}=stops[1];
  for(const gentle of [false,true]){
    const look=new RoomLook(),duration=gentle?3.2:2.4;
    const initial=look.heading(position,focus);look.faceHeading(initial+Math.PI,position,focus,gentle);
    near(look.yaw,0);look.update(duration/2);near(look.yaw,Math.PI/2);
    look.update(duration/2-.001);assert.ok(look.yaw<Math.PI&&look.yaw>Math.PI*.99);
    look.update(.002);near(look.yaw,Math.PI);assert.equal(look.autoTurn,null);
    look.update(5);near(look.yaw,Math.PI);
  }
});

test('automatic turning crosses the heading wrap by the short route in either direction',()=>{
  const position=new Vector3(0,1.6,0),focus=new Vector3(0,1.6,-1);
  for(const sign of [-1,1]){
    const look=new RoomLook();look.turn(-sign*179*Math.PI/180/.0045,0,position,focus);
    const before=look.yaw;look.faceHeading(-sign*179*Math.PI/180,position,focus);
    look.update(2.4);
    near(degrees(look.yaw-before),sign*2);
  }
});

test('a deliberate look gesture takes control from an automatic turn without a snap',()=>{
  const {position,focus}=stops[1],look=new RoomLook();
  look.faceHeading(look.heading(position,focus)+Math.PI,position,focus);look.update(.4);
  const before=look.yaw;look.turnTouch(20,0,position,focus);
  near(look.yaw,before);assert.equal(look.autoTurn,null);
  look.update(1);near(look.yaw,before-.02);
  look.stopTouch();look.faceHeading(look.heading(position,focus)+Math.PI,position,focus);
  look.update(.3);const stopped=look.yaw;look.stopAutoTurn();look.update(2);near(look.yaw,stopped);
});

test('an app interruption clears both pending touch and automatic camera movement',()=>{
  const {position,focus}=stops[1],look=new RoomLook();
  look.turnTouch(-200,-100,position,focus);look.update(.02);look.cancelMotion();
  const stopped={yaw:look.yaw,pitch:look.pitch};look.update(5);
  near(look.yaw,stopped.yaw);near(look.pitch,stopped.pitch);
  look.faceHeading(look.heading(position,focus)+Math.PI,position,focus);look.update(.2);look.cancelMotion();
  const yaw=look.yaw;look.update(5);near(look.yaw,yaw);
});

test('walking between stops cannot move the visitor beneath the floor',()=>{
  const look=new RoomLook();
  for(let step=0;step<=100;step++){
    const t=step/100,position=stops[0].position.clone().lerp(stops[2].position,t);
    const focus=stops[0].focus.clone().lerp(stops[2].focus,t);
    look.turn(-15,-30,position,focus);
    const {camera,vector}=direction(look,position,focus);
    assert.ok(camera.position.y>=1.6);
    assert.ok(degrees(Math.asin(vector.y))>=-89-1e-8);
    assert.ok(camera.position.equals(position));
  }
});
