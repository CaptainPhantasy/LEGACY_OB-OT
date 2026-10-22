"""Read-only support measurements for the five original upper-shelf book piles."""
import argparse,json,sys
from pathlib import Path
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree
p=argparse.ArgumentParser();p.add_argument('--root',required=True,type=Path);a=p.parse_args(sys.argv[sys.argv.index('--')+1:])
bpy.ops.wm.open_mainfile(filepath=str(a.root/'art/room-rabbit-holes.blend'),load_ui=False)
o=bpy.data.objects['OldCuriosityShop'];me=o.data;world=[o.matrix_world@v.co for v in me.vertices];parents=list(range(len(world)))
def root(i):
 while parents[i]!=i:parents[i]=parents[parents[i]];i=parents[i]
 return i
for edge in me.edges:
 u,v=map(root,edge.vertices)
 if u!=v:parents[v]=u
parts={};mats={}
for i in range(len(world)):parts.setdefault(root(i),[]).append(i)
for poly in me.polygons:mats.setdefault(root(poly.vertices[0]),set()).add(me.materials[poly.material_index].name)
components=[]
for key,indices in parts.items():
 lo=[min(world[i][k] for i in indices) for k in range(3)];hi=[max(world[i][k] for i in indices) for k in range(3)]
 components.append({'root':key,'indices':indices,'bounds':[lo,hi],'center':[(lo[k]+hi[k])/2 for k in range(3)],'materials':sorted(mats.get(key,set()))})
tree=BVHTree.FromPolygons(world,[list(poly.vertices) for poly in me.polygons],all_triangles=False)
report=[]
for number,(x,y,z) in enumerate([(-2.70,-4.5,2.76),(-2.67,-1.15,2.45),(2.66,-3.9,2.63),(2.60,.6,2.86),(-2.6,6.0,2.67)],1):
 found=[c for c in components if abs(c['center'][0]-x)<.10 and abs(c['center'][1]-y)<.10 and c['bounds'][0][2]>z-.015 and c['bounds'][1][2]<z+.145 and all(m.startswith('Book cloth') or m=='Antique paper' for m in c['materials'])]
 low=min(c['bounds'][0][2] for c in found);lowest=[c for c in found if abs(c['bounds'][0][2]-low)<.0001];assert len(found)==9 and len(lowest)==1,(number,len(found),len(lowest))
 center=lowest[0]['center'];hit,normal,face,distance=tree.ray_cast(Vector((center[0],center[1],low-.001)),Vector((0,0,-1)),4)
 samples=[]
 for dx in (-.10,0,.10):
  for dy in (-.12,0,.12):
   h,n,f,d=tree.ray_cast(Vector((center[0]+dx,center[1]+dy,low-.001)),Vector((0,0,-1)),4)
   samples.append({'xy':[center[0]+dx,center[1]+dy],'support_z':h.z if h else None,'normal':list(n) if n else None,'support_material':me.materials[me.polygons[f].material_index].name if h else None})
 report.append({'stack':number,'nominal_xyz':[x,y,z],'component_count':len(found),'vertex_count':sum(len(c['indices']) for c in found),'lowest_z':low,'support_z':hit.z,'gap_m':low-hit.z,'support_material':me.materials[me.polygons[face].material_index].name,'lowest_cover_bounds':lowest[0]['bounds'],'component_roots':[c['root'] for c in found],'components':[{'root':c['root'],'bounds':c['bounds'],'materials':c['materials'],'vertices':len(c['indices'])} for c in found],'samples':samples})
print('UPPER_BOOK_SUPPORT_AUDIT '+json.dumps({'native':'art/room-rabbit-holes.blend','object':o.name,'read_only':True,'stacks':report}),flush=True)
