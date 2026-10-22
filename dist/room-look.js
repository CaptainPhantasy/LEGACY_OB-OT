const radians=degrees=>degrees*Math.PI/180;
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
const lowestPitch=radians(-89),highestPitch=radians(89);
const sensitivity=.0045;
const touchSensitivity=.001;

// Turn freely through any number of revolutions, with the horizon kept level.
// Pitch limits are measured against the room, never the current object's tilt.
export class RoomLook {
  constructor(){this.reset();}
  reset(){this.yaw=0;this.pitch=0;this.cancelMotion();}
  cancelMotion(){this.stopTouch();this.autoTurn=null;}
  stopTouch(){this.targetYaw=this.yaw;this.targetPitch=this.pitch;this.touchPending=false;this.touchRelease=null;}
  releaseTouch(){
    if(!this.touchPending)return;
    this.touchPending=false;
    // Finish the requested swipe in a bounded 100 ms, even if it ended between
    // frames. Cancellation still stops immediately; no inertial spin is added.
    this.touchRelease={yaw:this.yaw,pitch:this.pitch,elapsed:0};
  }
  stopAutoTurn(){this.autoTurn=null;}
  basePitch(position,focus){
    return Math.atan2(focus.y-position.y,Math.hypot(focus.x-position.x,focus.z-position.z));
  }
  turn(dx,dy,position,focus){
    this.cancelMotion();
    const base=this.basePitch(position,focus);
    // Drag the room with your hand, like a panorama, on mouse and touch alike.
    this.yaw-=dx*sensitivity;
    this.pitch=clamp(base+this.pitch+dy*sensitivity,lowestPitch,highestPitch)-base;
  }
  turnTouch(dx,dy,position,focus){
    if(!this.touchPending)this.stopTouch();
    this.stopAutoTurn();this.touchPending=true;
    const base=this.basePitch(position,focus);
    this.targetYaw-=dx*touchSensitivity;
    this.targetPitch=clamp(base+this.targetPitch+dy*touchSensitivity,lowestPitch,highestPitch)-base;
  }
  faceHeading(heading,position,focus,gentle=false){
    this.stopTouch();
    const current=this.heading(position,focus),difference=Math.atan2(Math.sin(heading-current),Math.cos(heading-current));
    this.autoTurn={from:this.yaw,to:this.yaw+difference,elapsed:0,duration:gentle?3.2:2.4};
  }
  update(dt){
    if(!Number.isFinite(dt)||dt<=0)return;
    if(this.autoTurn){
      const turn=this.autoTurn;turn.elapsed=Math.min(turn.duration,turn.elapsed+dt);
      const t=turn.elapsed/turn.duration,eased=t*t*(3-2*t);
      this.yaw=turn.from+(turn.to-turn.from)*eased;
      if(t===1)this.autoTurn=null;
    }else if(this.touchRelease){
      const release=this.touchRelease;release.elapsed=Math.min(.1,release.elapsed+dt);
      const t=release.elapsed/.1,eased=t*t*(3-2*t);
      this.yaw=release.yaw+(this.targetYaw-release.yaw)*eased;
      this.pitch=release.pitch+(this.targetPitch-release.pitch)*eased;
      if(t===1)this.touchRelease=null;
    }else if(this.touchPending){
      const blend=1-Math.exp(-18*dt);
      this.yaw+=(this.targetYaw-this.yaw)*blend;
      this.pitch+=(this.targetPitch-this.pitch)*blend;
    }
  }
  heading(position,focus){return Math.atan2(focus.x-position.x,-(focus.z-position.z))+this.yaw;}
  target(position,focus,out){
    const dx=focus.x-position.x,dy=focus.y-position.y,dz=focus.z-position.z;
    const distance=Math.hypot(dx,dy,dz)||1;
    const yaw=Math.atan2(dx,-dz)+this.yaw;
    const pitch=clamp(this.basePitch(position,focus)+this.pitch,lowestPitch,highestPitch);
    const horizontal=Math.cos(pitch)*distance;
    return out.set(position.x+Math.sin(yaw)*horizontal,
      position.y+Math.sin(pitch)*distance,position.z-Math.cos(yaw)*horizontal);
  }
}
