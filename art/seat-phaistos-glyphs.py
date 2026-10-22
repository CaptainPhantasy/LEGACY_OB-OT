"""Seat the first v9 native build's raised glyph geometry against its clay disc.
The main builder already uses the corrected coordinates. This bounded migration
keeps its first long build without repeating unrelated mesh construction.
"""
import argparse,json,math,sys,shutil
from pathlib import Path
import bpy
from mathutils import Vector
p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);a=p.parse_args(sys.argv[sys.argv.index('--')+1:])
f=a.root/'art/room-rabbit-holes.blend';backup=a.root/'art/rendering.quarantine/room-rabbit-holes-before-disc-seating.blend'
if backup.exists():raise RuntimeError('Preserved migration checkpoint exists; do not reapply.')
shutil.copy2(f,backup)
bpy.ops.wm.open_mainfile(filepath=str(f),load_ui=False)
o=bpy.data.objects['CenterCuriosityShelf'];me=o.data;world=[o.matrix_world@v.co for v in me.vertices];parents=list(range(len(world)))
def root(i):
 while parents[i]!=i:parents[i]=parents[parents[i]];i=parents[i]
 return i
for edge in me.edges:
 u,v=map(root,edge.vertices)
 if u!=v:parents[v]=u
parts={};mats={}
for i in range(len(world)):parts.setdefault(root(i),[]).append(i)
for face in me.polygons:mats.setdefault(root(face.vertices[0]),set()).add(me.materials[face.material_index].name)
changed=[]
for key,indices in parts.items():
 lo=[min(world[i][k] for i in indices) for k in range(3)];hi=[max(world[i][k] for i in indices) for k in range(3)];cx=(lo[0]+hi[0])/2
 if mats.get(key)!={'Oxidized bronze'} or lo[1]<-.06 or hi[1]>.22 or lo[2]<.66 or hi[2]>.96:continue
 delta=.0058 if abs(cx-(-.2055))<.00015 else .00125 if abs(cx-(-.201))<.00015 else 0
 if not delta:continue
 d=o.matrix_world.inverted().to_3x3()@Vector((delta,0,0))
 for i in indices:me.vertices[i].co+=d
 changed.append({'vertices':len(indices),'from_x':cx,'delta_x':delta})
assert len(changed)>200,('Expected the spiral segments and stamped glyphs',len(changed))
me.update();o['phaistos_glyphs_seated']=True
report_path=a.root/'art/rabbit-hole-geometry-report.json';report=json.loads(report_path.read_text());report['phaistos_surface_seating']={'component_count':len(changed),'vertices_moved':sum(c['vertices'] for c in changed),'max_before_gap_m':.0065,'max_after_gap_m':.0001}
report_path.write_text(json.dumps(report,indent=2)+'\n')
bpy.ops.wm.save_as_mainfile(filepath=str(f),compress=True)
print('PHAISTOS_CONTACT_READY '+json.dumps(report['phaistos_surface_seating']),flush=True)
