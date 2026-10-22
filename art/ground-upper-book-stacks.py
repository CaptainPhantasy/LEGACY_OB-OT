"""Seat five original upper book piles on their measured shelf surfaces.

Run after build-rabbit-hole-shelf.py and before the final bake. This is a bounded
translation of 45 connected book parts, preserving topology, all three UV maps,
all other vertices, the hero book, and all lighting. No atlas repack is needed.
"""
import argparse,hashlib,json,shutil,struct,sys
from pathlib import Path
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree
p=argparse.ArgumentParser();p.add_argument('--root',required=True,type=Path);a=p.parse_args(sys.argv[sys.argv.index('--')+1:])
native=a.root/'art/room-rabbit-holes.blend';backup=a.root/'art/rendering.quarantine/room-rabbit-holes-before-upper-book-grounding.blend'
if backup.exists():
 if hashlib.sha256(backup.read_bytes()).digest()!=hashlib.sha256(native.read_bytes()).digest():raise RuntimeError('Native has changed since the preserved checkpoint; do not reapply.')
else:shutil.copy2(native,backup)
ns={'__name__':'__main__'}
exec(compile((a.root/'art/audit-upper-book-stack-support.py').read_text(),'audit-upper-book-stack-support.py','exec'),ns)
o=ns['o'];me=o.data;measurements=ns['report'];components={c['root']:c for c in ns['components']}
selected={i for s in measurements for key in s['component_roots'] for i in components[key]['indices']}
assert len(selected)==2520,'Unexpected upper book inventory.'

def vertices_hash(mesh,skip=set()):
 h=hashlib.sha256()
 for v in mesh.vertices:
  if v.index not in skip:h.update(struct.pack('<I3f',v.index,*v.co))
 return h.hexdigest()
def uvs_hash(mesh):
 h=hashlib.sha256()
 for layer in mesh.uv_layers:
  h.update(layer.name.encode())
  for uv in layer.data:h.update(struct.pack('<2f',*uv.uv))
 return h.hexdigest()
def topology_hash(mesh):
 h=hashlib.sha256()
 for q in mesh.polygons:h.update(struct.pack('<I',q.material_index));h.update(struct.pack('<%dI'%len(q.vertices),*q.vertices))
 return h.hexdigest()
def object_state(obj):
 matrix=[list(row) for row in obj.matrix_world]
 return [matrix,vertices_hash(obj.data),uvs_hash(obj.data),topology_hash(obj.data)]
before_uv=uvs_hash(me);before_topology=topology_hash(me);before_unmoved=vertices_hash(me,selected)
other_meshes={obj.name:object_state(obj) for obj in bpy.context.scene.objects if obj.type=='MESH' and obj!=o}
light_state={obj.name:[list(obj.location),list(obj.rotation_euler),obj.data.energy] for obj in bpy.context.scene.objects if obj.type=='LIGHT'}
for s in measurements:
 assert .05<s['gap_m']<.15,('Unexpected gap, stop before altering',s)
 delta=s['support_z']+.0005-s['lowest_z'];local_delta=o.matrix_world.inverted().to_3x3()@Vector((0,0,delta))
 for key in s['component_roots']:
  for i in components[key]['indices']:me.vertices[i].co+=local_delta
 s['delta_z_m']=delta
me.update();bpy.context.view_layer.update()
world=[o.matrix_world@v.co for v in me.vertices]
tree=BVHTree.FromPolygons(world,[list(q.vertices) for q in me.polygons],all_triangles=False)
for s in measurements:
 indices=[i for key in s['component_roots'] for i in components[key]['indices']]
 low=min(world[i].z for i in indices);lo,hi=s['lowest_cover_bounds'];x=(lo[0]+hi[0])/2;y=(lo[1]+hi[1])/2
 hit,normal,face,dist=tree.ray_cast(Vector((x,y,low-.0001)),Vector((0,0,-1)),4)
 assert hit is not None and normal.z>.98
 gap=low-hit.z
 assert .0003<gap<.0007,(s['stack'],'Not seated correctly',gap)
 s.update(after_lowest_z=low,after_support_z=hit.z,after_gap_m=gap)
assert uvs_hash(me)==before_uv and topology_hash(me)==before_topology,'UV or topology changed.'
assert vertices_hash(me,selected)==before_unmoved,'An unrelated room vertex changed.'
assert all(object_state(bpy.data.objects[name])==state for name,state in other_meshes.items()),'A protected non-room mesh changed.'
assert {obj.name:[list(obj.location),list(obj.rotation_euler),obj.data.energy] for obj in bpy.context.scene.objects if obj.type=='LIGHT'}==light_state,'Lighting changed.'
proof={'read_only':False,'native':str(native),'preserved_checkpoint':str(backup),'object':o.name,'stack_count':5,'components_moved':45,'vertices_moved':len(selected),'all_uvs_sha256':before_uv,'topology_sha256':before_topology,'unmoved_vertices_sha256':before_unmoved,'all_uvs_unchanged':True,'topology_and_materials_unchanged':True,'other_meshes_unchanged':True,'lighting_unchanged':True,'stacks':measurements}
(a.root/'art/upper-book-grounding-report.json').write_text(json.dumps(proof,indent=2)+'\n')
report_path=a.root/'art/rabbit-hole-geometry-report.json';report=json.loads(report_path.read_text())
report['shelf_build_protected_meshes_unchanged']=report.pop('all_protected_meshes_unchanged',True)
report['post_build_room_geometry_changes']={'reason':'Final head-on stills revealed five unsupported original upper-shelf book piles.','report':'art/upper-book-grounding-report.json','vertices_moved':len(selected),'all_other_geometry_and_uvs_preserved':True}
report['book_text_and_hero_mesh_unchanged']=True
report_path.write_text(json.dumps(report,indent=2)+'\n')
bpy.context.scene['room_depth_lightmap_needs_rebake']=True
bpy.ops.wm.save_as_mainfile(filepath=str(native),compress=True)
print('UPPER_BOOKS_GROUNDED '+json.dumps({k:proof[k] for k in ('stack_count','components_moved','vertices_moved','all_uvs_unchanged','topology_and_materials_unchanged','other_meshes_unchanged','lighting_unchanged')}),flush=True)
print('UPPER_BOOK_GAPS '+json.dumps([{'stack':s['stack'],'before_m':s['gap_m'],'after_m':s['after_gap_m']} for s in measurements]),flush=True)
