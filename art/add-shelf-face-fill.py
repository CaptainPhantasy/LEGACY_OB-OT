"""Add broad display fill without changing mesh geometry or UVs."""
import argparse,sys,shutil,json
from pathlib import Path
import bpy
from mathutils import Vector
p=argparse.ArgumentParser();p.add_argument('--root',required=True,type=Path);a=p.parse_args(sys.argv[sys.argv.index('--')+1:])
f=a.root/'art/room-rabbit-holes.blend'
bpy.ops.wm.open_mainfile(filepath=str(f),load_ui=False)
assert not any(o.name.startswith('Shelf soft face fill') for o in bpy.data.objects)
backup=a.root/'art/rendering.quarantine/room-rabbit-holes-before-display-fill.blend'
if not backup.exists():shutil.copy2(f,backup)
for side in (-1,1):
 for y in (-2.75,-1.5,-.25):
  data=bpy.data.lights.new('Shelf soft face fill','AREA')
  data.energy=28;data.shape='RECTANGLE';data.size=1.1;data.size_y=.8
  data.use_nodes=True
  bb=data.node_tree.nodes.new('ShaderNodeBlackbody');bb.inputs['Temperature'].default_value=3400
  emission=next(n for n in data.node_tree.nodes if n.type=='EMISSION')
  data.node_tree.links.new(bb.outputs['Color'],emission.inputs['Color'])
  light=bpy.data.objects.new('Shelf soft face fill',data);bpy.context.scene.collection.objects.link(light)
  light.location=(side*1.6,y,1.95)
  light.rotation_euler=(Vector((side*.2,y,1.0))-light.location).to_track_quat('-Z','Y').to_euler()
bpy.context.scene['room_depth_lightmap_needs_rebake']=True
bpy.ops.wm.save_as_mainfile(filepath=str(f),compress=True)
print('SHELF_FACE_FILL_READY: six broad 28W area sources, 3400K; geometry and UVs untouched')

