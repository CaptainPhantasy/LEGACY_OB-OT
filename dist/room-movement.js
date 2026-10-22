// Free walking uses a small floor map built once from the delivered geometry.
// Collision queries and route searches use this map, never a per-frame mesh scan.
export const ROOM_BOUNDS = Object.freeze({ minX: -3.08, maxX: 3.08, minZ: -8.16, maxZ: 7.3 });
export const WALK_SPEED = 1.35;
export const FAST_WALK_SPEED = 2.25;
export const BODY_RADIUS = .22;
const EPSILON = 1e-9;
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));

function finitePosition(p) {
  if (!p || p.length !== 3 || !Array.from(p).every(Number.isFinite)) throw new TypeError('A walking position needs three finite coordinates.');
  return p;
}
function segmentTouchesBox(ax, az, bx, bz, minX, maxX, minZ, maxZ) {
  let low = 0, high = 1;
  for (const [start, end, min, max] of [[ax, bx, minX, maxX], [az, bz, minZ, maxZ]]) {
    const d = end - start;
    if (Math.abs(d) < EPSILON) {
      if (start < min || start > max) return false;
    } else {
      const a = (min - start) / d, b = (max - start) / d;
      low = Math.max(low, Math.min(a, b));high = Math.min(high, Math.max(a, b));
      if (high < low) return false;
    }
  }
  return true;
}
function triangleTouchesCell(a, b, c, minX, maxX, minZ, maxZ) {
  for (const p of [a, b, c]) if (p[0] >= minX && p[0] <= maxX && p[1] >= minZ && p[1] <= maxZ) return true;
  for (const [p, q] of [[a, b], [b, c], [c, a]]) if (segmentTouchesBox(p[0], p[1], q[0], q[1], minX, maxX, minZ, maxZ)) return true;
  const cross = (p, q, x, z) => (q[0] - p[0]) * (z - p[1]) - (q[1] - p[1]) * (x - p[0]);
  if (Math.abs(cross(a, b, c[0], c[1])) < EPSILON) return false;
  for (const [x, z] of [[minX,minZ],[minX,maxZ],[maxX,minZ],[maxX,maxZ]]) {
    const u=cross(a,b,x,z),v=cross(b,c,x,z),w=cross(c,a,x,z);
    if ((u>=-EPSILON&&v>=-EPSILON&&w>=-EPSILON)||(u<=EPSILON&&v<=EPSILON&&w<=EPSILON)) return true;
  }
  return false;
}

function triangleNearPoint(data,i,x,z,radius) {
  const ax=data[i],az=data[i+1],bx=data[i+2],bz=data[i+3],cx=data[i+4],cz=data[i+5];
  const u=(bx-ax)*(z-az)-(bz-az)*(x-ax),v=(cx-bx)*(z-bz)-(cz-bz)*(x-bx),w=(ax-cx)*(z-cz)-(az-cz)*(x-cx);
  if(Math.abs((bx-ax)*(cz-az)-(bz-az)*(cx-ax))>EPSILON&&
    ((u>=-EPSILON&&v>=-EPSILON&&w>=-EPSILON)||(u<=EPSILON&&v<=EPSILON&&w<=EPSILON)))return true;
  const limit=radius*radius-EPSILON;
  for(const [px,pz,qx,qz] of [[ax,az,bx,bz],[bx,bz,cx,cz],[cx,cz,ax,az]]){
    const dx=qx-px,dz=qz-pz,denominator=dx*dx+dz*dz,t=denominator?clamp(((x-px)*dx+(z-pz)*dz)/denominator,0,1):0;
    if((x-px-dx*t)**2+(z-pz-dz*t)**2<limit)return true;
  }
  return false;
}

function pointSegmentDistanceSquared(x,z,ax,az,bx,bz) {
  const dx=bx-ax,dz=bz-az,length=dx*dx+dz*dz;
  const t=length?clamp(((x-ax)*dx+(z-az)*dz)/length,0,1):0;
  return (x-ax-dx*t)**2+(z-az-dz*t)**2;
}
function segmentDistanceSquared(ax,az,bx,bz,cx,cz,dx,dz) {
  const ux=bx-ax,uz=bz-az,vx=dx-cx,vz=dz-cz,denominator=ux*vz-uz*vx;
  if(Math.abs(denominator)>EPSILON){
    const wx=cx-ax,wz=cz-az,t=(wx*vz-wz*vx)/denominator,u=(wx*uz-wz*ux)/denominator;
    if(t>=0&&t<=1&&u>=0&&u<=1)return 0;
  }
  return Math.min(
    pointSegmentDistanceSquared(ax,az,cx,cz,dx,dz),pointSegmentDistanceSquared(bx,bz,cx,cz,dx,dz),
    pointSegmentDistanceSquared(cx,cz,ax,az,bx,bz),pointSegmentDistanceSquared(dx,dz,ax,az,bx,bz));
}
function triangleNearSegment(data,i,ax,az,bx,bz,radius) {
  if(triangleNearPoint(data,i,ax,az,radius)||triangleNearPoint(data,i,bx,bz,radius))return true;
  const limit=radius*radius-EPSILON;
  for(let edge=0;edge<3;edge++){
    const j=i+edge*2,k=i+(edge+1)%3*2;
    if(segmentDistanceSquared(ax,az,bx,bz,data[j],data[j+1],data[k],data[k+1])<limit)return true;
  }
  return false;
}

class FloorCollision {
  constructor({bounds=ROOM_BOUNDS,cellSize=.08,radius=BODY_RADIUS}={}) {
    if (!Number.isFinite(cellSize)||cellSize<.025||cellSize>.25||!Number.isFinite(radius)||radius<=0) throw new RangeError('Invalid walking map resolution or body radius.');
    this.bounds={...bounds};this.cellSize=cellSize;this.radius=radius;
    this.columns=Math.ceil((bounds.maxX-bounds.minX)/cellSize);
    this.rows=Math.ceil((bounds.maxZ-bounds.minZ)/cellSize);
    this.cells=new Uint8Array(this.columns*this.rows);
    this._boxes=[];this.boundary=null;this.triangleLists=null;this.triangleData=[];this.querySerial=0;
    this.stats={triangles:0,bodyTriangles:0,occupiedCells:0,buildMilliseconds:0};
  }
  markTriangle(a,b,c) {
    const s=this.cellSize,d=this.bounds;
    const x0=clamp(Math.floor((Math.min(a[0],b[0],c[0])-d.minX)/s),0,this.columns-1);
    const x1=clamp(Math.floor((Math.max(a[0],b[0],c[0])-d.minX)/s),0,this.columns-1);
    const z0=clamp(Math.floor((Math.min(a[1],b[1],c[1])-d.minZ)/s),0,this.rows-1);
    const z1=clamp(Math.floor((Math.max(a[1],b[1],c[1])-d.minZ)/s),0,this.rows-1);
    if(Math.max(a[0],b[0],c[0])<d.minX||Math.min(a[0],b[0],c[0])>d.maxX||
       Math.max(a[1],b[1],c[1])<d.minZ||Math.min(a[1],b[1],c[1])>d.maxZ)return;
    for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++){
      const index=z*this.columns+x;if(this.cells[index])continue;
      const px=d.minX+x*s,pz=d.minZ+z*s;
      if(triangleTouchesCell(a,b,c,px,px+s,pz,pz+s))this.cells[index]=1;
    }
  }
  markBox(box) {
    const a=[box.minX,box.minZ],b=[box.maxX,box.minZ],c=[box.maxX,box.maxZ],d=[box.minX,box.maxZ];
    this.markTriangle(a,b,c);this.markTriangle(a,c,d);this._boxes.push([a,b,c],[a,c,d]);
  }
  prepareBoundary() {
    this.boundary=new Uint8Array(this.cells.length);
    this.triangleLists=new Array(this.cells.length);
    for(let z=0;z<this.rows;z++)for(let x=0;x<this.columns;x++){
      const i=z*this.columns+x;if(!this.cells[i])continue;
      for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){
        const nx=x+dx,nz=z+dz;
        if(nx<0||nx>=this.columns||nz<0||nz>=this.rows||!this.cells[nz*this.columns+nx])this.boundary[i]=1;
      }
    }
  }
  indexBoundaryTriangle(a,b,c) {
    const s=this.cellSize,d=this.bounds;
    const x0=clamp(Math.floor((Math.min(a[0],b[0],c[0])-d.minX)/s),0,this.columns-1);
    const x1=clamp(Math.floor((Math.max(a[0],b[0],c[0])-d.minX)/s),0,this.columns-1);
    const z0=clamp(Math.floor((Math.min(a[1],b[1],c[1])-d.minZ)/s),0,this.rows-1);
    const z1=clamp(Math.floor((Math.max(a[1],b[1],c[1])-d.minZ)/s),0,this.rows-1);
    let triangle=-1;
    for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++){
      const index=z*this.columns+x;if(!this.boundary[index])continue;
      const px=d.minX+x*s,pz=d.minZ+z*s;
      if(!triangleTouchesCell(a,b,c,px,px+s,pz,pz+s))continue;
      if(triangle<0){triangle=this.triangleData.length/6;this.triangleData.push(a[0],a[1],b[0],b[1],c[0],c[1]);}
      (this.triangleLists[index]??=[]).push(triangle);
    }
  }
  isFree(x,z,radius=this.radius) {
    if(!Number.isFinite(x)||!Number.isFinite(z))return false;
    const b=this.bounds,s=this.cellSize;
    if(x-radius<b.minX||x+radius>b.maxX||z-radius<b.minZ||z+radius>b.maxZ)return false;
    const center=Math.floor((z-b.minZ)/s)*this.columns+Math.floor((x-b.minX)/s);
    // Deep interior cells cannot contain a person-sized gap. The map's boundary
    // cells use exact triangles, so raster rounding never steals aisle space.
    if(this.cells[center]&&!this.boundary[center])return false;
    const x0=Math.max(0,Math.floor((x-radius-b.minX)/s)),x1=Math.min(this.columns-1,Math.floor((x+radius-b.minX)/s));
    const z0=Math.max(0,Math.floor((z-radius-b.minZ)/s)),z1=Math.min(this.rows-1,Math.floor((z+radius-b.minZ)/s));
    if(++this.querySerial>=4294967295){this.seen.fill(0);this.querySerial=1;}
    for(let row=z0;row<=z1;row++)for(let column=x0;column<=x1;column++){
      const index=row*this.columns+column;if(!this.boundary[index])continue;
      const px=b.minX+column*s,pz=b.minZ+row*s;
      const dx=Math.max(px-x,0,x-px-s),dz=Math.max(pz-z,0,z-pz-s);
      if(dx*dx+dz*dz>=radius*radius-EPSILON)continue;
      for(const triangle of this.triangleLists[index]||[]){
        if(this.seen[triangle]===this.querySerial)continue;this.seen[triangle]=this.querySerial;
        if(triangleNearPoint(this.triangleData,triangle*6,x,z,radius))return false;
      }
    }
    return true;
  }
  sweepFree(ax,az,bx,bz) {
    if(!this.isFree(ax,az)||!this.isFree(bx,bz))return false;
    const b=this.bounds,s=this.cellSize,r=this.radius;
    const x0=Math.max(0,Math.floor((Math.min(ax,bx)-r-b.minX)/s));
    const x1=Math.min(this.columns-1,Math.floor((Math.max(ax,bx)+r-b.minX)/s));
    const z0=Math.max(0,Math.floor((Math.min(az,bz)-r-b.minZ)/s));
    const z1=Math.min(this.rows-1,Math.floor((Math.max(az,bz)+r-b.minZ)/s));
    if(++this.querySerial>=4294967295){this.seen.fill(0);this.querySerial=1;}
    // Broad phase follows the swept body through nearby grid cells. Narrow phase
    // tests continuous segment/triangle distances, so grazing a corner cannot
    // slip between samples at either a low frame rate or a long guided segment.
    for(let row=z0;row<=z1;row++)for(let column=x0;column<=x1;column++){
      const index=row*this.columns+column;if(!this.boundary[index])continue;
      const px=b.minX+column*s,pz=b.minZ+row*s;
      if(!segmentTouchesBox(ax,az,bx,bz,px-r,px+s+r,pz-r,pz+s+r))continue;
      for(const triangle of this.triangleLists[index]||[]){
        if(this.seen[triangle]===this.querySerial)continue;this.seen[triangle]=this.querySerial;
        if(triangleNearSegment(this.triangleData,triangle*6,ax,az,bx,bz,r))return false;
      }
    }
    return true;
  }
  lineFree(a,b) {return this.sweepFree(a[0],a[2],b[0],b[2]);}
  edgeFree(from,to,dx,dz) {
    const key=from*9+(dz+1)*3+dx+1;
    if(!this.edges[key]){
      const state=this.lineFree(this.center(from),this.center(to))?2:1;
      this.edges[key]=state;this.edges[to*9+(1-dz)*3+1-dx]=state;
    }
    return this.edges[key]===2;
  }
  center(index,y=0) {
    return [this.bounds.minX+(index%this.columns+.5)*this.cellSize,y,
      this.bounds.minZ+(Math.floor(index/this.columns)+.5)*this.cellSize];
  }
  finalize() {
    if(!this.boundary){this.prepareBoundary();for(const triangle of this._boxes)this.indexBoundaryTriangle(...triangle);}
    this.triangleData=new Float32Array(this.triangleData);
    this.seen=new Uint32Array(this.triangleData.length/6);
    this.stats.boundaryTriangles=this.seen.length;
    this.free=new Uint8Array(this.cells.length);this.edges=new Uint8Array(this.cells.length*9);
    for(let i=0;i<this.cells.length;i++){const p=this.center(i);this.free[i]=this.isFree(p[0],p[2])?1:0;}
    this.stats.occupiedCells=this.cells.reduce((total,value)=>total+value,0);
    return this;
  }
}

function fallbackCollision() {
  const map=new FloorCollision();
  // Geometry is the normal source. These authored surfaces also keep the
  // controller safe before a model is supplied, and make the module standalone.
  for(const box of [
    {minX:-.393,maxX:.393,minZ:-.5,maxZ:3.5},
    {minX:-3.08,maxX:-.70,minZ:-3.02,maxZ:-2.65},
    {minX:.70,maxX:3.08,minZ:-3.02,maxZ:-2.65},
    {minX:-1.13,maxX:1.13,minZ:-5.8,maxZ:-4.2},
  ])map.markBox(box);
  return map.finalize();
}

// room is the loaded Three.js scene; no Three.js dependency is needed here.
// Floors and rugs below 12 cm, and objects entirely above head height, do not
// become invisible floor barriers. Table tops and shelves intersect the body.
export function createRoomCollision(room,options={}) {
  if(!room||typeof room.traverse!=='function')throw new TypeError('A loaded scene is required for walking collision.');
  const started=performance.now(),map=new FloorCollision(options);
  const minY=options.minY??.12,maxY=options.maxY??1.85;
  room.updateMatrixWorld?.(true);
  function eachBodyTriangle(visit,countStats) {
    room.traverse(object=>{
      if(!object.isMesh||object.visible===false)return;
      const attribute=object.geometry?.attributes?.position,m=object.matrixWorld?.elements;
      if(!attribute||!m)return;
      const vertices=new Float32Array(attribute.count*3);
      for(let i=0;i<attribute.count;i++){
        const x=attribute.getX(i),y=attribute.getY(i),z=attribute.getZ(i),offset=i*3;
        vertices[offset]=m[0]*x+m[4]*y+m[8]*z+m[12];
        vertices[offset+1]=m[1]*x+m[5]*y+m[9]*z+m[13];
        vertices[offset+2]=m[2]*x+m[6]*y+m[10]*z+m[14];
      }
      const indices=object.geometry.index,count=indices?indices.count:attribute.count;
      for(let i=0;i<count;i+=3){
        const ia=(indices?indices.getX(i):i)*3,ib=(indices?indices.getX(i+1):i+1)*3,ic=(indices?indices.getX(i+2):i+2)*3;
        if(countStats)map.stats.triangles++;
        const low=Math.min(vertices[ia+1],vertices[ib+1],vertices[ic+1]),high=Math.max(vertices[ia+1],vertices[ib+1],vertices[ic+1]);
        if(high<minY||low>maxY)continue;
        if(countStats)map.stats.bodyTriangles++;
        if(low>=minY&&high<=maxY){
          visit([vertices[ia],vertices[ia+2]],[vertices[ib],vertices[ib+2]],[vertices[ic],vertices[ic+2]]);
        }else{
          let polygon=[ia,ib,ic].map(index=>[vertices[index],vertices[index+1],vertices[index+2]]);
          for(const [height,above] of [[minY,true],[maxY,false]]){
            const clipped=[];
            for(let j=0;j<polygon.length;j++){
              const a=polygon[j],b=polygon[(j+1)%polygon.length],insideA=above?a[1]>=height:a[1]<=height,insideB=above?b[1]>=height:b[1]<=height;
              if(insideA)clipped.push(a);
              if(insideA!==insideB){const t=(height-a[1])/(b[1]-a[1]);clipped.push(a.map((value,axis)=>value+(b[axis]-value)*t));}
            }
            polygon=clipped;
          }
          for(let j=1;j<polygon.length-1;j++)visit(...[polygon[0],polygon[j],polygon[j+1]].map(p=>[p[0],p[2]]));
        }
      }
    });
  }
  eachBodyTriangle((a,b,c)=>map.markTriangle(a,b,c),true);
  map.prepareBoundary();
  eachBodyTriangle((a,b,c)=>map.indexBoundaryTriangle(a,b,c),false);
  map.finalize();map.stats.buildMilliseconds=performance.now()-started;
  return map;
}

class MinHeap {
  constructor(){this.items=[];}
  push(index,score){const item={index,score},a=this.items;let i=a.length;a.push(item);while(i){const p=(i-1)>>1;if(a[p].score<=score)break;a[i]=a[p];i=p;}a[i]=item;}
  pop(){const a=this.items,result=a[0],last=a.pop();if(a.length){let i=0;while(i*2+1<a.length){let child=i*2+1;if(child+1<a.length&&a[child+1].score<a[child].score)child++;if(a[child].score>=last.score)break;a[i]=a[child];i=child;}a[i]=last;}return result;}
  get length(){return this.items.length;}
}

function routeResult(points) {
  const lengths=[0];for(let i=1;i<points.length;i++)lengths.push(lengths[i-1]+Math.hypot(...points[i].map((v,axis)=>v-points[i-1][axis])));
  return {points,lengths,length:lengths.at(-1)};
}
function nearestCell(map,p) {
  const x=Math.floor((p[0]-map.bounds.minX)/map.cellSize),z=Math.floor((p[2]-map.bounds.minZ)/map.cellSize);
  let best=-1,cost=Infinity;
  for(let dz=-2;dz<=2;dz++)for(let dx=-2;dx<=2;dx++){
    const column=x+dx,row=z+dz;if(column<0||column>=map.columns||row<0||row>=map.rows)continue;
    const index=row*map.columns+column;if(!map.free[index])continue;
    const center=map.center(index,p[1]),distance=Math.hypot(center[0]-p[0],center[2]-p[2]);
    if(distance<cost&&map.lineFree(p,center)){best=index;cost=distance;}
  }
  return best;
}

export class RoomMovement {
  constructor(collision){this.collision=collision||fallbackCollision();this.distance=0;}
  setCollision(collision){if(!collision?.isFree||!collision?.lineFree||!collision?.sweepFree)throw new TypeError('A walking collision map is required.');this.collision=collision;return this;}
  step(position,yaw,input={},dt=0,out=[0,0,0]) {
    finitePosition(position);
    if(!Number.isFinite(yaw)||!Number.isFinite(dt)||dt<0)throw new TypeError('Walking heading and time must be finite.');
    for(let axis=0;axis<3;axis++)out[axis]=position[axis];
    this.distance=0;
    let forward=Number.isFinite(input.forward)?clamp(input.forward,-1,1):0,right=Number.isFinite(input.right)?clamp(input.right,-1,1):0;
    const magnitude=Math.hypot(forward,right);if(!magnitude||dt===0)return out;
    if(magnitude>1){forward/=magnitude;right/=magnitude;}
    const speed=input.sprint?FAST_WALK_SPEED:WALK_SPEED;
    // Tab-resume gaps must not teleport the visitor; ordinary frames subdivide
    // to less than half a cell, preventing tunneling through a thin cabinet.
    const elapsed=Math.min(dt,.1),dx=(Math.sin(yaw)*forward+Math.cos(yaw)*right)*speed*elapsed;
    const dz=(-Math.cos(yaw)*forward+Math.sin(yaw)*right)*speed*elapsed;
    const steps=Math.max(1,Math.ceil(Math.hypot(dx,dz)/(this.collision.cellSize*.4)));
    const sx=dx/steps,sz=dz/steps,originX=out[0],originZ=out[2];
    for(let i=0;i<steps;i++){
      const x=out[0],z=out[2];
      if(this.collision.sweepFree(x,z,x+sx,z+sz)){out[0]+=sx;out[2]+=sz;continue;}
      // Slide along the wall instead of catching on it. Prefer the larger
      // component so diagonal behavior is symmetric when axes are exchanged.
      if(Math.abs(sx)>=Math.abs(sz)){
        if(this.collision.sweepFree(x,z,x+sx,z))out[0]+=sx;
        if(this.collision.sweepFree(out[0],z,out[0],z+sz))out[2]+=sz;
      }else{
        if(this.collision.sweepFree(x,z,x,z+sz))out[2]+=sz;
        if(this.collision.sweepFree(x,out[2],x+sx,out[2]))out[0]+=sx;
      }
    }
    this.distance=Math.hypot(out[0]-originX,out[2]-originZ);
    return out;
  }
  planPath(from,to) {
    finitePosition(from);finitePosition(to);const map=this.collision;
    if(!map.isFree(from[0],from[2])||!map.isFree(to[0],to[2]))throw new RangeError('The walking destination is occupied.');
    if(map.lineFree(from,to))return routeResult([Array.from(from),Array.from(to)]);
    const start=nearestCell(map,from),end=nearestCell(map,to);
    if(start<0||end<0)throw new RangeError('No clear route joins this walking position.');
    const score=new Float64Array(map.cells.length);score.fill(Infinity);
    const previous=new Int32Array(map.cells.length);previous.fill(-1);
    const visited=new Uint8Array(map.cells.length),heap=new MinHeap(),endPoint=map.center(end);
    const estimate=index=>{const p=map.center(index);return Math.hypot(p[0]-endPoint[0],p[2]-endPoint[2]);};
    score[start]=0;heap.push(start,estimate(start));
    while(heap.length){
      const {index}=heap.pop();if(visited[index])continue;visited[index]=1;if(index===end)break;
      const column=index%map.columns,row=Math.floor(index/map.columns);
      for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){
        if(!dx&&!dz)continue;
        const x=column+dx,z=row+dz;if(x<0||x>=map.columns||z<0||z>=map.rows)continue;
        const next=z*map.columns+x;
        if(!map.free[next]||visited[next])continue;
        if(dx&&dz&&(!map.free[row*map.columns+x]||!map.free[z*map.columns+column]))continue;
        if(!map.edgeFree(index,next,dx,dz))continue;
        const cost=score[index]+Math.hypot(dx,dz)*map.cellSize;
        if(cost<score[next]){score[next]=cost;previous[next]=index;heap.push(next,cost+estimate(next));}
      }
    }
    if(!visited[end])throw new RangeError('No clear walking route is available.');
    const indices=[end];while(indices[0]!==start)indices.unshift(previous[indices[0]]);
    const raw=[Array.from(from),...indices.map(i=>map.center(i,from[1])),Array.from(to)];
    const points=[raw[0]];let anchor=0;
    while(anchor<raw.length-1){let next=raw.length-1;while(next>anchor+1&&!map.lineFree(raw[anchor],raw[next]))next--;if(!map.lineFree(raw[anchor],raw[next]))throw new RangeError('A route segment is obstructed.');points.push(raw[next]);anchor=next;}
    const horizontal=[0];for(let i=1;i<points.length;i++)horizontal.push(horizontal[i-1]+Math.hypot(points[i][0]-points[i-1][0],points[i][2]-points[i-1][2]));
    const total=horizontal.at(-1);
    for(let i=1;i<points.length-1;i++)points[i][1]=from[1]+(to[1]-from[1])*(total?horizontal[i]/total:1);
    return routeResult(points);
  }
}
