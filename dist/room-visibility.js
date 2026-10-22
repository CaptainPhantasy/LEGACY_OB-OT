import * as THREE from 'three';

const STATIC_ROOTS=new Set(['OldCuriosityShop','CenterCuriosityShelf']);
const animatedAncestor=object=>{
  for(let node=object;node;node=node.parent)if(/BookCoverHinge|AncientBookCoverDetails|Book front leather cover/.test(node.name)||node.userData?.animated)return true;
  return false;
};
const staticRoomMesh=object=>{
  if(!object.isMesh||object.isSkinnedMesh||object.isInstancedMesh||animatedAncestor(object)||Object.keys(object.geometry?.morphAttributes||{}).length)return false;
  for(let node=object;node;node=node.parent)if(STATIC_ROOTS.has(node.name)||node.userData?.staticRoom)return true;
  return false;
};

// Each triangle is retained exactly once. Only its index moves to a room-sized
// cell; vertex data, normals and both baked-light UV channels remain shared.
export function partitionRoomMesh(mesh,cellSize=4){
  if(!Number.isFinite(cellSize)||cellSize<.5)throw new RangeError('Room cells must be at least half a metre wide.');
  const source=mesh.geometry,position=source?.getAttribute('position');
  if(!position)return [];
  const indices=source.index,count=indices?indices.count:position.count,cells=new Map();
  const start=Math.max(0,source.drawRange.start||0),end=Math.min(count,start+source.drawRange.count);
  const groups=source.groups.length?source.groups:[{start:0,count,materialIndex:0}];
  const vertex=new THREE.Vector3(),center=new THREE.Vector3(),localBox=new THREE.Box3();
  for(const group of groups){
    const first=Math.max(start,group.start),last=Math.min(end,group.start+group.count);
    for(let offset=first;offset+2<last;offset+=3){
      const a=indices?indices.getX(offset):offset,b=indices?indices.getX(offset+1):offset+1,c=indices?indices.getX(offset+2):offset+2;
      center.set(0,0,0);localBox.makeEmpty();
      for(const index of [a,b,c]){vertex.fromBufferAttribute(position,index);localBox.expandByPoint(vertex);center.add(vertex);}
      center.multiplyScalar(1/3).applyMatrix4(mesh.matrixWorld);
      const key=`${Math.floor(center.x/cellSize)}:${Math.floor(center.z/cellSize)}`;
      let cell=cells.get(key);
      if(!cell){cell={key,materials:new Map(),bounds:new THREE.Box3(),triangles:0};cells.set(key,cell);}
      let list=cell.materials.get(group.materialIndex);
      if(!list){list=[];cell.materials.set(group.materialIndex,list);}
      list.push(a,b,c);cell.bounds.union(localBox);cell.triangles++;
    }
  }
  if(cells.size<2)return [];
  return [...cells.values()].map(cell=>{
    const geometry=new THREE.BufferGeometry();
    for(const [name,attribute] of Object.entries(source.attributes))geometry.setAttribute(name,attribute);
    const order=[];
    for(const [materialIndex,list] of cell.materials){geometry.addGroup(order.length,list.length,materialIndex);for(const index of list)order.push(index);}
    geometry.setIndex(order);geometry.boundingBox=cell.bounds;
    geometry.boundingSphere=cell.bounds.getBoundingSphere(new THREE.Sphere());
    geometry.userData={...source.userData,roomCell:cell.key};
    const chunk=mesh.clone(false);chunk.geometry=geometry;chunk.material=mesh.material;chunk.name=`${mesh.name || 'Room'} · ${cell.key}`;
    chunk.frustumCulled=true;chunk.userData={...mesh.userData,roomCell:cell.key,triangleCount:cell.triangles};
    return chunk;
  });
}

export class RoomVisibility{
  constructor(room,{cellSize=4,minTriangles=64}={}){
    this.room=room;this.chunks=[];this.quarantine=[];this.frustum=new THREE.Frustum();this.projection=new THREE.Matrix4();
    this.stats={chunks:0,triangles:0,visibleChunks:0,visibleTriangles:0};
    room.updateMatrixWorld(true);
    const sources=[];room.traverse(object=>{if(staticRoomMesh(object))sources.push(object);});
    for(const source of sources){
      const count=(source.geometry.index?.count??source.geometry.getAttribute('position')?.count??0)/3;
      const pieces=count>=minTriangles?partitionRoomMesh(source,cellSize):[];
      if(!pieces.length){source.frustumCulled=true;this.chunks.push(source);continue;}
      const parent=source.parent,index=parent.children.indexOf(source),container=new THREE.Group();container.name=`${source.name || 'Room'} visibility cells`;
      // Original meshes remain in memory, available to restore; they are not in
      // the scene or raycasts, so no surface is rendered or selected twice.
      parent.remove(source);parent.add(container);container.add(...pieces);
      this.quarantine.push({source,parent,index,container});this.chunks.push(...pieces);
    }
    room.updateMatrixWorld(true);this.refreshBounds();
  }
  refreshBounds(){
    this.room.updateMatrixWorld(true);
    this.bounds=this.chunks.map(mesh=>{
      if(!mesh.geometry.boundingSphere)mesh.geometry.computeBoundingSphere();
      return mesh.geometry.boundingSphere.clone().applyMatrix4(mesh.matrixWorld);
    });
    this.stats.chunks=this.chunks.length;
    this.stats.triangles=this.chunks.reduce((count,mesh)=>count+(mesh.geometry.index?.count??mesh.geometry.attributes.position.count)/3,0);
    return this;
  }
  update(camera){
    camera.updateMatrixWorld();this.frustum.setFromProjectionMatrix(this.projection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
    let visibleChunks=0,visibleTriangles=0;
    this.chunks.forEach((mesh,index)=>{
      const visible=this.frustum.intersectsSphere(this.bounds[index]);mesh.userData.inView=visible;
      if(visible){visibleChunks++;visibleTriangles+=(mesh.geometry.index?.count??mesh.geometry.attributes.position.count)/3;}
    });
    this.stats.visibleChunks=visibleChunks;this.stats.visibleTriangles=visibleTriangles;
    // Do not set .visible=false: a surface outside the main camera may cast a
    // shadow into it. Three.js culls these smaller cells per camera, including
    // the shadow camera, using the conservative bounds installed above.
    return this.stats;
  }
  restore(){
    for(const {source,parent,index,container} of this.quarantine){
      parent.remove(container);parent.add(source);
      const current=parent.children.indexOf(source);parent.children.splice(current,1);parent.children.splice(index,0,source);
    }
    this.quarantine=[];this.chunks=[];this.bounds=[];this.stats={chunks:0,triangles:0,visibleChunks:0,visibleTriangles:0};
  }
}
