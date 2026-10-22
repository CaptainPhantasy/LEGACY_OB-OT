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

test('touch-sized swipes accumulate and the room remains level during diagonal looking',()=>{
  const {position,focus}=stops[1],look=new RoomLook();
  look.turn(-150,-100,position,focus);const first=look.yaw;
  look.turn(-150,-100,position,focus);assert.ok(look.yaw>first);
  assert.ok(degrees(look.yaw)>75,'two short phone swipes give a broad view');
  const {camera}=direction(look,position,focus);
  near(new Vector3(1,0,0).applyQuaternion(camera.quaternion).y,0);
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
