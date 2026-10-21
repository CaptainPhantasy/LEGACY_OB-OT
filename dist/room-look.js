const radians=degrees=>degrees*Math.PI/180;
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
const yawLimit=radians(135),lowestPitch=radians(-55),highestPitch=radians(80);
const sensitivity=.0045;

// Turn in place around the current stop, with the horizon kept level.
// Pitch limits are measured against the room, never the current object's tilt.
export class RoomLook {
  constructor(){this.reset();}
  reset(){this.yaw=0;this.pitch=0;}
  basePitch(position,focus){
    return Math.atan2(focus.y-position.y,Math.hypot(focus.x-position.x,focus.z-position.z));
  }
  turn(dx,dy,position,focus){
    const base=this.basePitch(position,focus);
    // Drag the room with your hand, like a panorama, on mouse and touch alike.
    this.yaw=clamp(this.yaw-dx*sensitivity,-yawLimit,yawLimit);
    this.pitch=clamp(base+this.pitch+dy*sensitivity,lowestPitch,highestPitch)-base;
  }
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
