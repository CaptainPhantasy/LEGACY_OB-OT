import bpy, json, os, struct, hashlib
from mathutils import Vector
ROOT='/Volumes/Storage/LAI-BookOfTruths/sites/immutable-truths'
blend=ROOT+'/art/antique-bookstore.blend';glb=ROOT+'/dist/assets/bookstore.glb'
assert bpy.data.filepath==blend, ('Wrong Blender source opened',bpy.data.filepath)
assert bpy.context.scene.get('asset_story','').startswith('Sunday 4:45. A cramped unassuming'), 'Wrong room revision'
assert 'OldCuriosityShop' in bpy.data.objects, 'Missing curiosity shop architecture'
source_hinge=bpy.data.objects['BookCoverHinge']
assert abs(source_hinge.rotation_euler[1])<.001, 'Saved source must start closed'
assert len(source_hinge.children)>=2, 'Cover and combined age details must move with the hinge'
assert bpy.context.scene.get('book_age_profile','').startswith('Warped cracked'), 'Ancient book revision missing'
assert 'AncientBookCoverDetails' in bpy.data.objects, 'Missing physical repairs and worn cover details'
assert len(bpy.data.objects['Book front leather cover'].data.vertices)>1000, 'Cover must have actual warped surface geometry'
assert os.path.getsize(blend)<32_000_000, 'Editable scene exceeds handoff size budget'
raw=open(glb,'rb').read();assert raw[:4]==b'glTF';assert struct.unpack('<I',raw[4:8])[0]==2
assert len(raw)<25_000_000, ('Deployment asset budget exceeded',len(raw))
n=struct.unpack('<I',raw[12:16])[0];g=json.loads(raw[20:20+n])
node=next(n for n in g['nodes'] if n.get('name')=='BookCoverHinge')
assert all(abs(a-b)<.0002 for a,b in zip(node['translation'],[-.43,1.108,-4.92]))
assert len(g.get('images',[]))>=16, 'Expected Blender-baked age and relief surfaces'
# Independently reopen the runtime export, then move its real hinge.
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)
hinge=bpy.data.objects['BookCoverHinge']
cover=next(o for o in hinge.children if o.name.startswith('Book front leather cover'))
bpy.context.view_layer.update();closed=cover.matrix_world.translation.copy()
hinge.rotation_mode='XYZ';hinge.rotation_euler[1]=-2.75;bpy.context.view_layer.update();opened=cover.matrix_world.translation.copy()
assert closed.x>hinge.location.x+.3, ('Closed cover is misplaced',closed[:])
assert opened.x<hinge.location.x-.3 and opened.z>closed.z+.1, ('Opening did not lift the cover across its spine',opened[:])
print(json.dumps({'status':'PASS','blender':bpy.app.version_string,'source_reopened':blend,'runtime_reopened':glb,'runtime_bytes':len(raw),'runtime_meshes':len(g.get('meshes',[])),'baked_images':len(g.get('images',[])),'normal_mapped_materials':sum('normalTexture' in m for m in g.get('materials',[])),'cover_closed_center':list(closed),'cover_open_center':list(opened),'hashes':{os.path.basename(p):hashlib.sha256(open(p,'rb').read()).hexdigest() for p in [blend,glb]}},indent=2))
