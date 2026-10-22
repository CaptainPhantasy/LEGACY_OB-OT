import bpy,json
from mathutils import Vector
ROOT='/Volumes/Storage/LAI-BookOfTruths/sites/immutable-truths';ART=ROOT+'/art';ASSET=ROOT+'/dist/assets'
scene=bpy.context.scene
mesh=bpy.data.objects['OldCuriosityShop'];inv=mesh.matrix_world.inverted();count=0
lamp=next(o for o in scene.objects if o.type=='LIGHT' and abs(o.location.x+.86)<.01 and abs(o.location.z-1.31)<.01)
if lamp.location.y<5.5:
    for v in mesh.data.vertices:
        co=mesh.matrix_world@v.co
        if -1.10<co.x<-.60 and 5.06<co.y<5.46 and .95<co.z<1.61:
            co.y+=.40;v.co=inv@co;count+=1
    lamp.location.y+=.4
    assert count>80,('Table lamp geometry not found',count)
scene['lamp_clearance']='Table lamp moved behind the open cover; lamp center Blender y=5.66.'
bpy.ops.wm.save_as_mainfile(filepath=ART+'/antique-bookstore.blend',compress=True)
bpy.ops.object.select_all(action='DESELECT')
for o in scene.objects:
    if (o.type=='MESH' and o.name!='Render-only dust') or o.name=='BookCoverHinge':o.select_set(True)
bpy.ops.export_scene.gltf(filepath=ASSET+'/bookstore.glb',export_format='GLB',use_selection=True,export_apply=True,export_yup=True,export_lights=False,export_cameras=False,export_materials='EXPORT',export_texcoords=True,export_normals=True)
mp=ART+'/scene-metadata.json';m=json.load(open(mp));m['lamp_positions_gltf'][-1]=[-.86,1.31,-5.66];json.dump(m,open(mp,'w'),indent=2)
print('LAMP_CLEARANCE_EXPORT_COMPLETE',count,flush=True)
scene.render.filepath=ASSET+'/poster.png';bpy.ops.render.render(write_still=True)
hinge=bpy.data.objects['BookCoverHinge'];hinge.rotation_euler[1]=-2.75
camera=scene.camera;camera.location=(.95,3.49,2.27);camera.rotation_euler=(Vector((-.13,4.92,1.06))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=43
scene.render.resolution_x=1300;scene.render.resolution_y=1000;scene.render.filepath=ART+'/book-open.png';bpy.ops.render.render(write_still=True)
print('LAMP_CLEARANCE_COMPLETE',flush=True)
