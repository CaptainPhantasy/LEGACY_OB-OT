"""Material-only migration after v9 UV packing; preserves every vertex and UV.

Retarget exactly the five connected housing pieces of the Black Vault file box.
Existing paper labels, letters, folders, handle and lock keep their materials.
"""
import argparse,hashlib,json,math,shutil,struct,sys
from pathlib import Path
import bpy
p=argparse.ArgumentParser();p.add_argument('--root',required=True,type=Path);a=p.parse_args(sys.argv[sys.argv.index('--')+1:])
f=a.root/'art/room-rabbit-holes.blend';backup=a.root/'art/rendering.quarantine/room-rabbit-holes-before-steel-case.blend'
if backup.exists():raise RuntimeError('Material migration checkpoint exists; do not reapply.')
shutil.copy2(f,backup)
bpy.ops.wm.open_mainfile(filepath=str(f),load_ui=False)
o=bpy.data.objects['CenterCuriosityShelf'];me=o.data

def geometry_uv_hash(mesh):
 h=hashlib.sha256()
 for vertex in mesh.vertices:h.update(struct.pack('<3f',*vertex.co))
 for poly in mesh.polygons:h.update(struct.pack('<%dI'%len(poly.vertices),*poly.vertices))
 for layer in mesh.uv_layers:
  for uv in layer.data:h.update(struct.pack('<2f',*uv.uv))
 return h.hexdigest()
before=geometry_uv_hash(me)
world=[o.matrix_world@v.co for v in me.vertices];parents=list(range(len(world)))
def root(i):
 while parents[i]!=i:parents[i]=parents[parents[i]];i=parents[i]
 return i
for edge in me.edges:
 u,v=map(root,edge.vertices)
 if u!=v:parents[v]=u
parts={};faces={}
for i in range(len(world)):parts.setdefault(root(i),[]).append(i)
for poly in me.polygons:faces.setdefault(root(poly.vertices[0]),[]).append(poly)
# Exact world-space bounds from the canonical five beveled boxes.
expected=[
 ('bottom',[[-.320,-1.660,1.180],[-.090,-1.340,1.198]]),
 ('front',[[-.321,-1.660,1.198],[-.309,-1.340,1.376]]),
 ('back',[[-.106,-1.660,1.198],[-.094,-1.340,1.378]]),
 ('side-a',[[-.310,-1.352,1.198],[-.100,-1.340,1.378]]),
 ('side-b',[[-.310,-1.660,1.198],[-.100,-1.648,1.378]])]
matched=[]
for name,bounds in expected:
 candidates=[]
 for key,indices in parts.items():
  if {me.materials[q.material_index].name for q in faces.get(key,[])}!={'Old ebony joinery'}:continue
  low=[min(world[i][axis] for i in indices) for axis in range(3)]
  high=[max(world[i][axis] for i in indices) for axis in range(3)]
  if max(abs(v-w) for vv,ww in zip((low,high),bounds) for v,w in zip(vv,ww))<.00015:candidates.append(key)
 assert len(candidates)==1,(name,'Expected one connected housing piece',candidates)
 matched.append((name,candidates[0]))
assert len({key for name,key in matched})==5
m=bpy.data.materials.new('Black steel archive case');m.use_nodes=True;m.diffuse_color=(.025,.030,.035,1)
n=m.node_tree.nodes;l=m.node_tree.links;bsdf=n.get('Principled BSDF');bsdf.inputs['Base Color'].default_value=(.025,.030,.035,1)
bsdf.inputs['Roughness'].default_value=.55;bsdf.inputs['Metallic'].default_value=.7;bsdf.inputs['IOR'].default_value=1.45
tex=n.new('ShaderNodeTexNoise');tex.inputs['Scale'].default_value=235;tex.inputs['Detail'].default_value=3
ramp=n.new('ShaderNodeValToRGB');ramp.color_ramp.elements[0].color=(.385,.385,.385,1);ramp.color_ramp.elements[1].color=(.6875,.6875,.6875,1)
l.new(tex.outputs['Fac'],ramp.inputs[0]);l.new(ramp.outputs['Color'],bsdf.inputs['Roughness'])
bump=n.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.10;bump.inputs['Distance'].default_value=.00015
l.new(tex.outputs['Fac'],bump.inputs['Height']);l.new(bump.outputs[0],bsdf.inputs['Normal'])
me.materials.append(m);slot=len(me.materials)-1;changed_faces=[]
for name,key in matched:
 for face in faces[key]:face.material_index=slot;changed_faces.append(face.index)
assert geometry_uv_hash(me)==before,'Material migration changed geometry or UVs.'
report_path=a.root/'art/rabbit-hole-geometry-report.json';report=json.loads(report_path.read_text())
report['materials_added']=sorted(set(report['materials_added']+['Black steel archive case']))
report['black_steel_material_migration']={'components':[name for name,key in matched],'faces_changed':len(changed_faces),'geometry_uv_sha256':before,'geometry_and_all_uvs_preserved':True,'only_housing_materials_changed':True}
for part in report.get('parts',[]):
 if part['id']=='black-vault' and part['name'].startswith(('File box bottom','Black steel case front','Black steel case back','Black steel side')):part['material']='Black steel archive case'
report_path.write_text(json.dumps(report,indent=2)+'\n')
bpy.context.scene['room_depth_lightmap_needs_rebake']=True
bpy.ops.wm.save_as_mainfile(filepath=str(f),compress=True)
print('BLACK_STEEL_READY '+json.dumps(report['black_steel_material_migration']),flush=True)
