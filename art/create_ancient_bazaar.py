import bpy, math, random, os, json
from mathutils import Vector
from math import pi, sin, cos
random.seed(445)
ROOT='/Volumes/Storage/LAI-BookOfTruths/sites/immutable-truths'
ART=ROOT+'/art'; ASSET=ROOT+'/dist/assets'
os.makedirs(ART,exist_ok=True); os.makedirs(ASSET,exist_ok=True)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
for d in list(bpy.data.materials): bpy.data.materials.remove(d)

# All geometry is authored in Blender. glTF carries the carefully chosen PBR materials.
def mat(name,c,metal=0,rough=.65,emission=None):
    m=bpy.data.materials.new(name); m.diffuse_color=(*c,1); m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF'); p.inputs['Base Color'].default_value=(*c,1); p.inputs['Roughness'].default_value=rough; p.inputs['Metallic'].default_value=metal
    if emission:
        p.inputs['Emission Color'].default_value=(*c,1); p.inputs['Emission Strength'].default_value=emission
    return m
wood=[mat('Walnut • patina %02d'%i,(.047+i*.006,.033+i*.004,.021+i*.003),rough=.91) for i in range(9)]
dark=mat('Old ebony joinery',(.032,.021,.017),rough=.82)
wall=mat('Damp grey green plaster',(.065,.073,.060),rough=.99)
gold=mat('Tarnished old brass',(.22,.16,.072),metal=.63,rough=.69)
goldbright=mat('Gold leaf lettering',(.72,.48,.15),metal=.69,rough=.30)
bronze=mat('Oxidized bronze',(.12,.105,.055),metal=.65,rough=.58)
cream=mat('Faded linen',(.56,.45,.29),rough=.94)
paper=mat('Antique paper',(.51,.40,.255),rough=.94)
pageLight=mat('Ivory page edges',(.67,.56,.37),rough=.86)
pageDark=mat('Page shadows',(.30,.23,.13),rough=1)
leather=mat('Ox-blood leather',(.072,.023,.017),rough=.78)
leatherTop=mat('Leather raised tooling',(.17,.052,.024),rough=.59)
rug=mat('Threadbare burgundy rug',(.115,.022,.027),rough=1)
rugGold=mat('Rug ochre weave',(.245,.137,.055),rough=1)
shade=mat('Amber blown glass',(.85,.47,.16),rough=.28,emission=.5)
lightMat=mat('Warm lamp glow',(1,.68,.28),rough=.3,emission=2.6)
bookcolors=[(.16,.032,.025),(.09,.105,.072),(.065,.12,.11),(.12,.10,.06),(.055,.065,.09),(.22,.11,.055),(.11,.04,.044),(.22,.18,.13),(.065,.04,.035),(.14,.12,.095)]
bookmats=[mat('Book cloth %02d'%i,c,rough=.8) for i,c in enumerate(bookcolors)]
# Bake Blender procedural grain into portable PBR textures for the real-time site.
def bake_surface(m,kind):
    scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=1
    nodes=m.node_tree.nodes;links=m.node_tree.links;p=nodes.get('Principled BSDF');out=nodes.get('Material Output')
    uv=nodes.new('ShaderNodeTexCoord');mapping=nodes.new('ShaderNodeVectorMath');mapping.operation='MULTIPLY'
    mapping.inputs[1].default_value=(42,1.8,1) if kind=='wood' else ((7,7,1) if kind=='wall' else (110,110,1))
    links.new(uv.outputs['UV'],mapping.inputs[0])
    noise=nodes.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=1;noise.inputs['Detail'].default_value=5;noise.inputs['Roughness'].default_value=.72
    links.new(mapping.outputs['Vector'],noise.inputs['Vector'])
    ramp=nodes.new('ShaderNodeValToRGB');c=m.diffuse_color[:3]
    ramp.color_ramp.elements[0].position=.17;ramp.color_ramp.elements[0].color=tuple(v*.42 for v in c)+(1,)
    ramp.color_ramp.elements[1].position=.82;ramp.color_ramp.elements[1].color=tuple(min(.95,v*1.55) for v in c)+(1,)
    links.new(noise.outputs['Fac'],ramp.inputs['Fac'])
    emit=nodes.new('ShaderNodeEmission');links.new(ramp.outputs['Color'],emit.inputs['Color']);links.new(emit.outputs[0],out.inputs['Surface'])
    image=bpy.data.images.new(m.name+' — Blender baked surface',width=256,height=256);image.colorspace_settings.name='sRGB'
    tex=nodes.new('ShaderNodeTexImage');tex.image=image;nodes.active=tex
    bpy.ops.mesh.primitive_plane_add(size=2,location=(1000,1000,1000));plane=bpy.context.object;plane.data.materials.append(m)
    bpy.ops.object.bake(type='EMIT',margin=4)
    image.pack();links.new(p.outputs['BSDF'],out.inputs['Surface']);links.new(tex.outputs['Color'],p.inputs['Base Color'])
    for n in [uv,mapping,noise,ramp,emit]:nodes.remove(n)
    bpy.data.objects.remove(plane,do_unlink=True)
for material in wood:bake_surface(material,'wood')
bake_surface(leather,'leather');bake_surface(leatherTop,'leather');bake_surface(wall,'wall')
print('Portable Blender surface textures baked',flush=True)
static=[]
def finish(o,name,m,parent=None,join=True):
    o.name=name
    if m:o.data.materials.append(m)
    if parent:
        o.parent=parent; o.matrix_parent_inverse=parent.matrix_world.inverted()
    elif join: static.append(o)
    return o
def cube(name,loc,scale,m,bevel=0,parent=None,join=True):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc); o=bpy.context.object; o.dimensions=scale
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if bevel:
        b=o.modifiers.new('Soft worn edges','BEVEL');b.width=bevel;b.segments=2
        bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=b.name)
    return finish(o,name,m,parent,join)
def cyl(name,loc,r,depth,m,verts=20,parent=None,rot=None):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts,radius=r,depth=depth,location=loc);o=bpy.context.object
    if rot:o.rotation_euler=rot
    return finish(o,name,m,parent)
def sphere(name,loc,scale,m,parent=None):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16,ring_count=8,location=loc);o=bpy.context.object;o.scale=scale
    for p in o.data.polygons:p.use_smooth=True
    return finish(o,name,m,parent)
def torus(name,loc,major,minor,m,rot=None,parent=None):
    bpy.ops.mesh.primitive_torus_add(major_segments=36,minor_segments=8,location=loc,major_radius=major,minor_radius=minor);o=bpy.context.object
    if rot:o.rotation_euler=rot
    return finish(o,name,m,parent)
def rod(name,a,b,r,m,parent=None):
    mid=(Vector(a)+Vector(b))/2;vec=Vector(b)-Vector(a)
    o=cyl(name,mid,r,vec.length,m,12,parent);o.rotation_euler=vec.to_track_quat('Z','Y').to_euler();return o
def curve(name,points,r,m,parent=None,cyclic=False):
    data=bpy.data.curves.new(name,'CURVE');data.dimensions='3D';data.resolution_u=1;data.bevel_depth=r;data.bevel_resolution=2
    poly=data.splines.new('POLY');poly.points.add(len(points)-1)
    for p,co in zip(poly.points,points):p.co=(*co,1)
    poly.use_cyclic_u=cyclic;o=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(o);finish(o,name,m,parent)
    bpy.context.view_layer.objects.active=o;o.select_set(True);bpy.ops.object.convert(target='MESH');o.select_set(False)
    return o
FONT='/System/Library/Fonts/Supplemental/Georgia.ttf'
if os.path.exists(FONT): font=bpy.data.fonts.load(FONT)
else: font=None
def text(name,body,loc,size,m,rotation=(0,0,0),parent=None,align='CENTER'):
    data=bpy.data.curves.new(name,'FONT');data.body=body;data.size=size;data.resolution_u=2;data.extrude=.0004;data.bevel_depth=0;data.bevel_resolution=0;data.align_x=align;data.align_y='CENTER';data.space_character=1.15
    if font:data.font=font
    o=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(o);o.location=loc;o.rotation_euler=rotation;finish(o,name,m,parent)
    bpy.context.view_layer.objects.active=o;bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.ops.object.convert(target='MESH');o.select_set(False);return o


# Layered procedural surfaces are baked by Blender and packed into the source and GLB.
def bake_ancient_surface(name,kind):
    m=mat(name,(.045,.025,.012) if kind=='leather' else ((.40,.32,.19) if kind=='paper' else (.10,.105,.075)),rough=.96)
    ns=m.node_tree.nodes;lk=m.node_tree.links;p=ns.get('Principled BSDF');out=ns.get('Material Output')
    uv=ns.new('ShaderNodeTexCoord')
    coarse=ns.new('ShaderNodeTexNoise');coarse.inputs['Scale'].default_value=7;coarse.inputs['Detail'].default_value=5;coarse.inputs['Roughness'].default_value=.78;lk.new(uv.outputs['UV'],coarse.inputs['Vector'])
    fine=ns.new('ShaderNodeTexNoise');fine.inputs['Scale'].default_value=150 if kind=='leather' else 95;fine.inputs['Detail'].default_value=3;lk.new(uv.outputs['UV'],fine.inputs['Vector'])
    ramp=ns.new('ShaderNodeValToRGB');ramp.color_ramp.elements[0].position=.20;ramp.color_ramp.elements[1].position=.82
    if kind=='leather':
        ramp.color_ramp.elements[0].color=(.010,.006,.003,1);ramp.color_ramp.elements[1].color=(.105,.055,.021,1)
    elif kind=='paper':
        ramp.color_ramp.elements[0].color=(.15,.10,.045,1);ramp.color_ramp.elements[1].color=(.62,.51,.31,1)
    else:
        ramp.color_ramp.elements[0].color=(.023,.030,.017,1);ramp.color_ramp.elements[1].color=(.16,.155,.11,1)
    lk.new(coarse.outputs['Fac'],ramp.inputs['Fac']);color=ramp.outputs['Color'];height=fine.outputs['Fac']
    if kind=='leather':
        warp=ns.new('ShaderNodeVectorMath');warp.operation='SCALE';warp.inputs[3].default_value=.085;lk.new(coarse.outputs['Color'],warp.inputs[0])
        add=ns.new('ShaderNodeVectorMath');add.operation='ADD';lk.new(uv.outputs['UV'],add.inputs[0]);lk.new(warp.outputs['Vector'],add.inputs[1])
        vor=ns.new('ShaderNodeTexVoronoi');vor.feature='DISTANCE_TO_EDGE';vor.inputs['Scale'].default_value=43;lk.new(add.outputs['Vector'],vor.inputs['Vector'])
        cracks=ns.new('ShaderNodeMapRange');cracks.clamp=True;cracks.inputs['From Min'].default_value=.003;cracks.inputs['From Max'].default_value=.026;lk.new(vor.outputs['Distance'],cracks.inputs['Value'])
        mix=ns.new('ShaderNodeMixRGB');mix.blend_type='MIX';mix.inputs[1].default_value=(.004,.003,.002,1);lk.new(cracks.outputs['Result'],mix.inputs[0]);lk.new(color,mix.inputs[2]);color=mix.outputs[0];height=cracks.outputs['Result']
        sep=ns.new('ShaderNodeSeparateXYZ');lk.new(uv.outputs['UV'],sep.inputs[0]);mins=[]
        for ch in ['X','Y']:
            inv=ns.new('ShaderNodeMath');inv.operation='SUBTRACT';inv.inputs[0].default_value=1;lk.new(sep.outputs[ch],inv.inputs[1])
            mn=ns.new('ShaderNodeMath');mn.operation='MINIMUM';lk.new(sep.outputs[ch],mn.inputs[0]);lk.new(inv.outputs[0],mn.inputs[1]);mins.append(mn.outputs[0])
        mn=ns.new('ShaderNodeMath');mn.operation='MINIMUM';lk.new(mins[0],mn.inputs[0]);lk.new(mins[1],mn.inputs[1])
        edge=ns.new('ShaderNodeMapRange');edge.clamp=True;edge.inputs['From Min'].default_value=.008;edge.inputs['From Max'].default_value=.105;edge.inputs['To Min'].default_value=.9;edge.inputs['To Max'].default_value=0;lk.new(mn.outputs[0],edge.inputs['Value'])
        factor=ns.new('ShaderNodeMath');factor.operation='MULTIPLY';lk.new(edge.outputs[0],factor.inputs[0]);lk.new(coarse.outputs['Fac'],factor.inputs[1])
        worn=ns.new('ShaderNodeMixRGB');worn.blend_type='MIX';lk.new(factor.outputs[0],worn.inputs[0]);lk.new(color,worn.inputs[1]);worn.inputs[2].default_value=(.19,.105,.043,1);color=worn.outputs[0]
    bump=ns.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.72;bump.inputs['Distance'].default_value=.012 if kind=='leather' else .007;lk.new(height,bump.inputs['Height']);lk.new(bump.outputs[0],p.inputs['Normal'])
    emit=ns.new('ShaderNodeEmission');lk.new(color,emit.inputs['Color']);lk.new(emit.outputs[0],out.inputs['Surface'])
    size=1024 if kind=='leather' else 512
    colorImg=bpy.data.images.new(name+' / baked color',width=size,height=size);colorImg.colorspace_settings.name='sRGB'
    tex=ns.new('ShaderNodeTexImage');tex.image=colorImg;ns.active=tex
    bpy.ops.mesh.primitive_plane_add(size=2,location=(1000,1000,1000));pl=bpy.context.object;pl.data.materials.append(m)
    bpy.context.scene.render.engine='CYCLES';bpy.context.scene.cycles.samples=1;bpy.ops.object.bake(type='EMIT',margin=8);colorImg.pack()
    lk.new(p.outputs['BSDF'],out.inputs['Surface'])
    normalImg=bpy.data.images.new(name+' / baked worn relief',width=size,height=size);normalImg.colorspace_settings.name='Non-Color'
    nt=ns.new('ShaderNodeTexImage');nt.image=normalImg;ns.active=nt;bpy.ops.object.bake(type='NORMAL',margin=8);normalImg.pack()
    keep={p,out,tex,nt}
    for node in list(ns):
        if node not in keep:ns.remove(node)
    normal=ns.new('ShaderNodeNormalMap');normal.inputs['Strength'].default_value=.80;lk.new(nt.outputs['Color'],normal.inputs['Color']);lk.new(normal.outputs[0],p.inputs['Normal']);lk.new(tex.outputs['Color'],p.inputs['Base Color'])
    bpy.data.objects.remove(pl,do_unlink=True)
    return m
ancientLeather=bake_ancient_surface('Desiccated cracked leather','leather')
foxedPaper=bake_ancient_surface('Centuries of foxing in rag paper','paper')
cellarStone=bake_ancient_surface('Damp soot-blackened cellar stone','stone')
rawhide=mat('Exposed abraded rawhide',(.115,.070,.030),rough=.99)
oldGilt=mat('Almost vanished gilt',(.105,.065,.022),metal=.21,rough=.90)
fadedTitle=mat('Surviving worn title impression',(.30,.21,.10),metal=.12,rough=.96)
stitchMat=mat('Blackened repair thread',(.15,.123,.071),rough=1)
pageEdgeMats=[mat('Uneven darkened leaf %02d'%i,(.28+i*.024,.215+i*.020,.115+i*.014),rough=1) for i in range(9)]
print('Ancient leather, paper and masonry surfaces baked',flush=True)

book_vertices=[];book_faces=[];book_materials=[];book_material_index=[]
def book_spine(x,y,z,w,h,d,rotation=0):
    col=random.choice(bookmats);lean=random.uniform(-.035,.035)
    def part(n,l,s,m):
        if m not in book_materials:book_materials.append(m)
        mi=book_materials.index(m);vstart=len(book_vertices)
        for dx,dy,dz in [(-1,-1,-1),(-1,-1,1),(-1,1,-1),(-1,1,1),(1,-1,-1),(1,-1,1),(1,1,-1),(1,1,1)]:
            lx=l[0]+dx*s[0]/2;ly=l[1]+dy*s[1]/2;lz=l[2]+dz*s[2]/2;lx+=lean*(lz/max(h,.1))
            book_vertices.append((x+lx*cos(rotation)-ly*sin(rotation),y+lx*sin(rotation)+ly*cos(rotation),z+lz))
        for face in [(0,4,6,2),(1,3,7,5),(0,1,5,4),(2,6,7,3),(0,2,3,1),(4,5,7,6)]:
            book_faces.append(tuple(vstart+i for i in face));book_material_index.append(mi)
    part('Book spine',(0,-d/2,h/2),(w,.028,h),col)
    part('Upper book cover',(0,0,h-.008),(w,d,.016),col)
    part('Lower book cover',(0,0,.008),(w,d,.016),col)
    part('Book page block',(0,.006,h/2),(max(.025,w-.015),d-.025,h-.036),paper)
    for zz in [.07,h-.065]:part('Spine gilt band',(0,-d/2-.016,zz),(w*.88,.005,.009),gold)
    if w>.075:
        part('Faded spine label',(0,-d/2-.017,h*.64),(w*.67,.006,min(.10,h*.2)),random.choice([cream,gold,leather]))
        if random.random()>.5:part('Spine label rule',(0,-d/2-.021,h*.63),(w*.48,.002,.003),dark)

# The place is a cramped, ordinary curiosity shop; the extraordinary only happens on opening.
wallDark=mat('Damp plaster shadows',(.028,.036,.025),rough=1)
brick=mat('Exposed old brick',(.095,.048,.033),rough=.95)
rust=mat('Rusted iron',(.075,.042,.023),metal=.38,rough=.90)
cloth=mat('Dusty canvas',(.115,.104,.075),rough=1)
webmat=mat('Almost invisible cobwebs',(.25,.25,.20),rough=1)
red=mat('Faded red paper lantern',(.19,.047,.027),rough=.87)
bottleMats=[mat('Dusty bottle %02d'%i,c,rough=.39) for i,c in enumerate([(.035,.065,.043),(.09,.055,.022),(.057,.073,.070),(.12,.096,.064)])]
# Low floorboards and a continuous blackened underfloor.
cube('Continuous dark subfloor',(0,.5,-.12),(6.4,15.8,.12),dark)
for ix in range(20):
    x=-3.03+ix*.32
    for iy in range(8):
        rawy=-7.6+iy*2.2+(1.1 if ix%2 else 0);lo=max(-7.3,rawy-1.092);hi=min(8.3,rawy+1.092)
        if hi<=lo:continue
        y=(lo+hi)/2;length=hi-lo
        o=cube('Uneven grey walnut floorboard',(x,y,-.025+random.uniform(-.004,.004)),(.314,length,.06),random.choice(wood),.003)
        for n in range(2):cube('Old split in floorboard',(x+random.uniform(-.13,.13),y+random.uniform(-length*.4,length*.4),.008),(.003,random.uniform(.12,min(.7,length)),.002),dark)
        if length>.3:
            for sy in [-1,1]:cyl('Old square nail',(x-.10,y+sy*(length/2-.07),.009),.007,.003,rust,6)
for side in [-1,1]:
    cube('Unwashed shop wall',(side*3.18,.5,1.65),(.17,15.8,3.3),wall)
    cube('Rotten skirting',(side*3.06,.5,.13),(.10,15.7,.23),wood[0],.007)
    # Patches of uncovered brick below fallen plaster.
    for row in range(5):
        for col in range(8):
            if random.random()<.19:continue
            y=-5.8+col*.29+(row%2)*.145;z=.24+row*.14
            cube('Exposed uneven brick',(side*3.083,y,z),(.025,.27,.12),brick,.007)
    for y,z in [(-2.4,1.7),(4.8,2.3)]:
        curve('Hairline plaster crack',[(side*3.079,y,z),(side*3.079,y+.08,z-.15),(side*3.079,y+.03,z-.28),(side*3.079,y+.13,z-.48)],.004,dark)
cube('Windowless rear wall',(0,8.25,1.65),(6.4,.16,3.3),wall)
cube('Dark low ceiling',(0,.5,3.29),(6.5,15.8,.15),dark)
for i,y in enumerate([-6.6,-4.2,-1.6,1.0,3.6,6.8]):
    o=cube('Crooked heavy ceiling joist',(0,y,3.11),(6.35,.22,.30),wood[i%4],.018);o.rotation_euler=(random.uniform(-.025,.025),random.uniform(-.018,.018),random.uniform(-.04,.04))
    for x in [-2.2,.8]:cube('Rough beam iron strap',(x,y,2.98),(.08,.25,.015),rust)
# A rough, narrow doorway hides the back room. No decorative arch or grand hall.
for x in [-1.98,1.98]:
    cube('Back-room partition',(x,2.93,1.62),(2.42,.17,3.24),wall)
for x in [-.78,.78]:
    o=cube('Crooked back-room jamb',(x,2.82,1.13),(.14,.25,2.26),wood[0],.012);o.rotation_euler[1]=-.015 if x<0 else .025
cube('Low rough doorway lintel',(0,2.82,2.32),(1.78,.27,.19),wood[2],.015)
cube('Plaster above narrow door',(0,2.94,2.85),(1.6,.17,.76),wall)
# Ragged dust curtains drawn to the edges of the doorway.
for side in [-1,1]:
    vertices=[];faces=[]
    for row in range(7):
        z=.12+row*.35
        for col in range(5):
            x=side*(.69+col*.065);y=2.66+.045*sin(col*2.5+row*.23)
            vertices.append((x,y,z+(.025*sin(col*3) if row==0 else 0)))
    for row in range(6):
        for col in range(4):
            a=row*5+col;faces.append((a,a+1,a+6,a+5))
    mesh=bpy.data.meshes.new('Hanging dust cloth');mesh.from_pydata(vertices,[],faces);o=bpy.data.objects.new('Ragged doorway curtain',mesh);bpy.context.collection.objects.link(o);finish(o,o.name,cloth)

# Rough shelf bays with irregular spacing, differing heights, and no matching decoration.
def rough_shelf(x,y,width,angle,height=2.45,rows=4,fill=.76):
    def tr(p):return (x+p[0]*cos(angle)-p[1]*sin(angle),y+p[0]*sin(angle)+p[1]*cos(angle),p[2])
    def box(n,p,size,m):
        o=cube(n,tr(p),size,m,.007);o.rotation_euler[2]=angle;return o
    for xx in [-width/2,width/2]:box('Uneven shelf side',(xx,.02,height/2),(.09,.46,height),random.choice(wood))
    box('Dark mismatched cabinet back',(0,.25,height/2),(width,.035,height),wood[0])
    for row in range(rows+1):
        z=.14+row*(height-.20)/rows
        box('Sagging timber shelf',(0,0,z),(width+.08,.53,.055),wood[(row+2)%len(wood)])
        if row==rows:continue
        p=-width/2+.07
        while p<width/2-.12:
            w=random.uniform(.068,.14)
            if random.random()>fill:p+=.15;continue
            h=random.uniform(.25,min(.44,(height-.20)/rows-.06));bx,by,bz=tr((p+w/2,-.08,z+.033))
            book_spine(bx,by,bz,w,h,random.uniform(.22,.30),angle);p+=w+.018
for x,y,width,angle,height,rows,fill in [(-2.77,-4.95,2.55,pi/2+.025,2.70,5,.78),(-2.74,-1.20,2.25,pi/2-.025,2.38,4,.55),(2.76,-3.90,2.38,-pi/2-.035,2.56,5,.74),(2.77,.20,2.34,-pi/2+.02,2.77,5,.52),(-2.78,5.73,2.8,pi/2+.02,2.6,5,.75),(2.77,6.45,2.6,-pi/2-.025,2.45,4,.66),(-1.72,7.96,2.2,.012,2.56,5,.83),(1.43,8.01,1.78,-.024,2.3,4,.64)]:rough_shelf(x,y,width,angle,height,rows,fill)
book_mesh=bpy.data.meshes.new('Mixed secondhand books');book_mesh.from_pydata(book_vertices,[],book_faces);book_mesh.update()
for m in book_materials:book_mesh.materials.append(m)
for f,mi in zip(book_mesh.polygons,book_material_index):f.material_index=mi
book_obj=bpy.data.objects.new('Mixed secondhand books',book_mesh);bpy.context.collection.objects.link(book_obj);static.append(book_obj)

# Piles, crates, jars and small oddities crowd the edges but keep a narrow path free.
def stack_book(x,y,z,w=.42,l=.62,th=.065,angle=0):
    col=random.choice(bookmats)
    for zz,ww,ll,tt,mm in [(z,w,l,.012,col),(z+th/2,w-.02,l-.025,th-.015,paper),(z+th,w,l,.012,col)]:
        o=cube('Loose dusty book',(x,y,zz),(ww,ll,tt),mm,.004);o.rotation_euler[2]=angle

def crate(x,y,z,w=.72,l=.64,h=.58,tilt=0):
    cube('Black interior of old packing crate',(x,y,z+h/2),(w-.04,l-.04,h-.03),dark)
    for side in [-1,1]:
        for row in range(4):cube('Crate side slat',(x+side*w/2,y,z+.07+row*(h-.08)/4),(.035,l,.09),wood[(row+3)%9],.003)
        for row in range(4):cube('Crate front slat',(x,y+side*l/2,z+.07+row*(h-.08)/4),(w,.035,.09),wood[(row+1)%9],.003)
        for xx in [-w/2+.08,w/2-.08]:cube('Crate rough corner',(x+xx,y+side*(l/2+.02),z+h/2),(.065,.03,h),wood[0])
    cube('Aged shipping label',(x-.07,y-l/2-.025,z+h*.55),(w*.30,.003,.13),cream)

def bottle(x,y,z,h=.27,r=.055):
    m=random.choice(bottleMats)
    cyl('Old bottle body',(x,y,z+h*.33),r,h*.60,m,12)
    sphere('Old bottle shoulder',(x,y,z+h*.62),(r,r,h*.12),m)
    cyl('Old bottle neck',(x,y,z+h*.79),r*.43,h*.28,m,12)
    cyl('Cork stopper',(x,y,z+h*.96),r*.46,h*.055,wood[2],10)
    if random.random()>.3:cube('Faded bottle label',(x,y-r-.001,z+h*.36),(r*1.4,.002,h*.22),paper,.002)

for x,y,z,w,l,h in [(-1.98,-5.70,.015,.76,.78,.65),(2.01,-5.55,.015,.86,.80,.58),(-1.92,-3.45,.015,.70,.68,.62),(2.07,-1.85,.015,.78,.62,.48),(-2.03,1.55,.015,.70,.78,.55),(2.15,4.0,.015,.72,.73,.53),(-2.18,7.2,.015,.70,.68,.50)]:crate(x,y,z,w,l,h)
for x,y,start,count in [(-1.99,-5.7,.72,4),(1.96,-5.55,.65,7),(-1.83,-3.48,.70,3),(1.95,-1.85,.55,5),(-2.10,1.55,.62,6),(1.57,.85,.02,9),(-1.62,-.25,.02,6),(2.0,4.0,.60,4)]:
    for i in range(count):stack_book(x+random.uniform(-.06,.06),y+random.uniform(-.06,.06),start+i*.067,random.uniform(.32,.50),random.uniform(.43,.62),.061,random.uniform(-.3,.3))
# Cabinet of oddities: narrow battered chest, mismatched tiny drawers and a crowded top.
cube('Cabinet of oddities body',(-2.17,-.38,.65),(.90,1.0,1.3),wood[0],.015)
for row in range(4):
    for col in range(3):
        xx=-2.47+col*.30;zz=.20+row*.28
        cube('Mismatched apothecary drawer',(xx,-.905,zz),(.275,.05,.245),wood[(row*2+col)%9],.005)
        sphere('Small tarnished drawer pull',(xx,-.942,zz),(.022,.015,.022),bronze)
for x,y,h in [(-2.44,-.52,.26),(-2.2,-.35,.39),(-1.95,-.52,.23),(-2.34,-.10,.30),(-2.01,-.10,.32)]:bottle(x,y,1.31,h,.065)
text('Oddities cabinet tag','ODDS & ENDS',(-2.17,-.941,1.17),.052,cream,rotation=(pi/2,0,0))
for side in [-1,1]:
    for j in range(7):bottle(side*2.43,-1.9+j*.35,1.35+(j%2)*.03,random.uniform(.17,.32),random.uniform(.035,.06))

# Empty bent birdcages, dusty baskets, and suspended bronze bells.
def cage(x,y,z,r=.25,h=.58):
    cyl('Birdcage dirty tray',(x,y,z),r+.03,.04,bronze,24)
    for zz in [.04,h*.73]:torus('Birdcage old iron hoop',(x,y,z+zz),r,.006,rust)
    for i in range(14):
        a=i*2*pi/14;xx=x+r*cos(a);yy=y+r*sin(a)
        pts=[(xx,yy,z+.035),(xx,yy,z+h*.70),(x+r*.7*cos(a),y+r*.7*sin(a),z+h*.90),(x,y,z+h)]
        curve('Birdcage bent iron bar',pts,.005,bronze)
    torus('Birdcage hanging hook',(x,y,z+h+.05),.043,.006,bronze,rot=(pi/2,0,0))
cage(-1.74,-2.8,1.69,.23,.60);rod('Old birdcage chain',(-1.74,-2.8,2.35),(-1.74,-2.8,3.05),.006,bronze)
cage(2.13,-.74,.04,.28,.70)
for x,y,z in [(1.52,-3.2,2.46),(1.76,-3.13,2.32),(1.95,-3.2,2.55)]:
    rod('Bell hanging string',(x,y,z+.15),(x,y,3.03),.004,cloth)
    bpy.ops.mesh.primitive_cone_add(vertices=16,radius1=.075,radius2=.035,depth=.12,location=(x,y,z));finish(bpy.context.object,'Old bronze bell',bronze)
# An old covered wicker basket is one more unanswered curiosity.
cyl('Covered wicker basket',(1.78,1.64,.46),.37,.70,wood[3],24)
for zz in [.15,.25,.35,.45,.55,.65,.75]:torus('Wicker basket band',(1.78,1.64,zz),.373,.009,wood[1])
for a in range(20):
    t=a*2*pi/20;rod('Wicker basket upright',(1.78+.373*cos(t),1.64+.373*sin(t),.12),(1.78+.373*cos(t),1.64+.373*sin(t),.79),.008,wood[5])
sphere('Wicker basket dusty lid',(1.78,1.64,.82),(.38,.38,.07),cloth)

# A small atlas and globe sit amongst clutter instead of an exhibition pedestal.
GX,GY,GZ=2.01,.82,1.18
sea=mat('Dust-darkened globe',(.105,.125,.085),rough=.94)
sphere('Small old globe',(GX,GY,GZ),(.22,.22,.22),sea)
for lat in [-45,0,45]:torus('Globe latitude',(GX,GY,GZ+.223*sin(math.radians(lat))),.223*cos(math.radians(lat)),.0015,bronze)
torus('Small globe iron meridian',(GX,GY,GZ),.25,.009,bronze,rot=(pi/2,.20,0))
cyl('Small globe stand',(GX,GY,.91),.10,.14,wood[1],16)
for i in range(4):stack_book(2.05,.82,.60+i*.065,.56,.65,.06,.05-i*.06)
# Scattered tied documents and rolled maps close to the edge of the aisle.
for x,y,z in [(-1.75,-4.6,.10),(1.55,-2.7,.10),(-2.1,5.8,.65)]:
    for i in range(3):
        o=cyl('Rolled old map',(x+i*.06,y,z),.025,.42,paper,12,rot=(pi/2,0,.12));
    torus('Map bundle tie',(x+.06,y,z),.07,.004,cloth,rot=(pi/2,0,0))

# Cobwebs are small, irregular, and tucked into corners.
def cobweb(anchor,a,b):
    for t in [.2,.4,.6,.8,1]:
        pa=Vector(anchor)+(Vector(a)-Vector(anchor))*t;pb=Vector(anchor)+(Vector(b)-Vector(anchor))*t
        mid=(pa+pb)/2;mid.z-=.04*t
        curve('Old cobweb ring',[pa,mid,pb],.0015,webmat)
    for t in [0,.25,.5,.75,1]:curve('Old cobweb spoke',[anchor,Vector(a).lerp(Vector(b),t)],.0018,webmat)
cobweb((-3.04,-6,3.02),(-2.23,-6,3.02),(-3.04,-6,2.29))
cobweb((.73,2.64,2.24),(.16,2.64,2.24),(.73,2.64,1.75))
cobweb((3.04,5.8,3.02),(2.45,5.8,3.02),(3.04,5.8,2.38))

# Dense, asymmetrical accumulated objects make the cellar feel like a shopkeeper's memory.
mortar=mat('Black mortar and damp earth',(.019,.023,.015),rough=1)
flakedPlaster=mat('Crumbling lime plaster',(.115,.114,.084),rough=1)
terracotta=mat('Old unglazed pottery',(.15,.073,.037),rough=.94)
verdigris=mat('Copper green patina',(.045,.084,.066),metal=.22,rough=.90)
ink=mat('Faded charcoal ink',(.055,.047,.028),rough=1)
ropeMat=mat('Stained hemp rope',(.10,.083,.047),rough=1)
clothRust=mat('Faded madder hanging cloth',(.13,.057,.035),rough=1)
clothBlue=mat('Indigo cloth worn almost grey',(.046,.062,.061),rough=1)
# Exposed damp masonry breaks up both large partition panels and the foreground walls.
for side in [-1,1]:
    for row in range(13):
        z=.13+row*.235;x=.87+(row%2)*.18
        while x<3.05:
            w=random.uniform(.28,.48)
            o=cube('Uneven cellar masonry',(side*(x+w/2),2.817+random.uniform(-.012,.008),z),(w-.018,.075,random.uniform(.194,.223)),cellarStone,.014)
            o.rotation_euler[1]=random.uniform(-.014,.014);x+=w
    for row in range(10):
        for j in range(6):
            y=-6.9+j*.31+(row%2)*.14;z=.13+row*.24
            if random.random()<.14:continue
            cube('Foreground damp brickwork',(side*3.075,y,z),(.06,.289,.22),cellarStone,.014)
# Broken lime plaster remains in irregular islands above the wet stone.
for side in [-1,1]:
    for i in range(9):
        cx=side*random.uniform(1.12,2.86);cz=random.uniform(.35,2.95);rx=random.uniform(.10,.32);rz=random.uniform(.08,.26)
        pts=[]
        for j in range(9):
            t=j*2*pi/9;pts.append((cx+rx*cos(t)*(1+random.uniform(-.25,.2)),2.768,cz+rz*sin(t)*(1+random.uniform(-.25,.2))))
        mesh=bpy.data.meshes.new('Flaking plaster island');mesh.from_pydata(pts,[],[tuple(range(9))]);o=bpy.data.objects.new('Flaking plaster island',mesh);bpy.context.collection.objects.link(o);finish(o,o.name,flakedPlaster)
# Irregular flagstones interrupt the old wooden boards down the narrow walking strip.
for j in range(10):
    y=-6.8+j*.89
    for side in [-1,1]:
        x=side*random.uniform(.28,.48)
        o=cube('Old cellar flagstone',(x,y+random.uniform(-.12,.12),.016),(.70+random.uniform(-.12,.1),.72+random.uniform(-.1,.1),.045),cellarStone,.022)
        o.rotation_euler[2]=random.uniform(-.035,.035)
# Old notices, receipts, diagrams and paper scraps overlap like geological layers.
def wall_paper(cx,y,cz,w,h,angle=0,with_lines=True):
    local=[(-.49,-.50),(.40,-.50),(.50,-.39),(.48,.48),(-.43,.5),(-.50,.34),(-.47,-.20)]
    pts=[]
    for u,v in local:
        px=u*w;pz=v*h;pts.append((cx+px*cos(angle)-pz*sin(angle),y+random.uniform(-.006,.004),cz+px*sin(angle)+pz*cos(angle)))
    mesh=bpy.data.meshes.new('Torn old paper');mesh.from_pydata(pts,[],[tuple(range(len(pts)))]);uv=mesh.uv_layers.new(name='Old paper UV')
    for p in mesh.polygons:
        for li in p.loop_indices:
            u,v=local[mesh.loops[li].vertex_index];uv.data[li].uv=(u+.5,v+.5)
    o=bpy.data.objects.new('Layered torn notice',mesh);bpy.context.collection.objects.link(o);finish(o,o.name,foxedPaper)
    if with_lines:
        for i in range(random.randint(3,7)):
            pz=-h*.30+i*h*.09;left=-w*.37;right=random.uniform(.15,.37)*w
            a=(cx+left*cos(angle)-pz*sin(angle),y-.008,cz+left*sin(angle)+pz*cos(angle))
            b=(cx+right*cos(angle)-pz*sin(angle),y-.008,cz+right*sin(angle)+pz*cos(angle))
            curve('Faded illegible handwriting',[a,b],.0012,ink)
for side in [-1,1]:
    for i in range(18):wall_paper(side*random.uniform(1.00,2.77),2.715-i*.001,random.uniform(.70,2.48),random.uniform(.16,.41),random.uniform(.15,.36),random.uniform(-.24,.24))
for title,x,z in [('REPAIRS',-1.35,2.03),('UNCLAIMED',1.43,1.94),('DO NOT WIND',2.30,1.42)]:
    wall_paper(x,2.66,z,.40,.16,-.04,False);text('A small forgotten notice',title,(x,2.648,z),.034,ink,rotation=(pi/2,0,-.04))
# Thin hanging textiles, tied to odd nails rather than arranged as decoration.
def rag(x,y,z,w,h,m):
    verts=[];faces=[];nx,ny=10,16
    for row in range(ny+1):
        t=row/ny
        for col in range(nx+1):
            u=col/nx;xx=x+(u-.5)*w;yy=y+.055*sin(u*7*pi+.7*t)+.10*t*t
            zz=z-t*h-.035*sin(u*8)*(t**8)-.06*sin(pi*u)
            verts.append((xx,yy,zz))
    for row in range(ny):
        for col in range(nx):
            if row>ny-3 and col in [1,7] and random.random()<.6:continue
            a=row*(nx+1)+col;faces.append((a,a+1,a+nx+2,a+nx+1))
    mesh=bpy.data.meshes.new('Moth eaten hanging textile');mesh.from_pydata(verts,[],faces);o=bpy.data.objects.new('Moth eaten hanging textile',mesh);bpy.context.collection.objects.link(o);finish(o,o.name,m)
    for sx in [-1,1]:rod('Cloth tying cord',(x+sx*w*.48,y,z-.04),(x+sx*w*.50,y,3.04),.005,ropeMat)
rag(-1.92,-5.92,2.94,.76,1.02,clothRust)
rag(2.16,-2.18,2.93,.63,1.38,clothBlue)
rag(-2.33,4.05,2.99,.71,1.11,cloth)
# Loose coiled rope overhead, knots and hanging cords make the upper room busy.
for x,y,drop in [(-2.55,-4.1,.7),(1.92,-5.1,.65),(-1.12,1.98,.44),(2.66,4.8,.8)]:
    pts=[]
    for i in range(61):
        t=i/60*2*pi*2.8;pts.append((x+.15*cos(t),y+.06*sin(t),2.70-i/60*.25))
    curve('Old rope coil',pts,.010,ropeMat);curve('Dangling rope end',[(x+.1,y,2.58),(x+.12,y+.02,2.50-drop*.5),(x+.08,y,2.50-drop)],.010,ropeMat)
# Old pottery has open mouths and uneven profiles.
def old_pot(x,y,z,h=.55,r=.22):
    profile=[(r*.39,0),(r*.76,h*.05),(r,h*.33),(r*.93,h*.63),(r*.58,h*.82),(r*.40,h*.87),(r*.40,h),(r*.30,h),(r*.29,h*.88)]
    verts=[];faces=[];n=20
    for rr,zz in profile:
        for i in range(n):
            a=i*2*pi/n;rad=rr*(1+.035*sin(i*4));verts.append((x+rad*cos(a),y+rad*sin(a),z+zz))
    for row in range(len(profile)-1):
        for i in range(n):a=row*n+i;b=row*n+(i+1)%n;faces.append((a,b,b+n,a+n))
    mesh=bpy.data.meshes.new('Irregular old earthenware');mesh.from_pydata(verts,[],faces);o=bpy.data.objects.new('Old open earthenware jar',mesh);bpy.context.collection.objects.link(o);finish(o,o.name,terracotta)
    for p in mesh.polygons:p.use_smooth=True
    cyl('Dark jar interior',(x,y,z+h*.82),r*.31,.006,dark,20)
for args in [(-2.36,-6.55,.04,.66,.25),(-1.80,-6.10,.04,.42,.18),(-2.76,-6.38,.04,.87,.23),(2.38,-5.97,.04,.51,.19),(-1.66,1.98,.04,.60,.22),(2.55,4.38,.04,.66,.24)]:old_pot(*args)
# A battered gramophone, its dented horn half hidden by books.
GX,GY,GZ=1.73,-4.65,1.01
cube('Cracked gramophone box',(GX,GY,GZ),(.55,.49,.24),wood[0],.018)
cyl('Dusty gramophone platter',(GX,GY,GZ+.136),.20,.015,dark,32)
rod('Old gramophone crank',(GX+.28,GY,GZ),(GX+.40,GY,GZ),.012,bronze)
rod('Old gramophone crank grip',(GX+.40,GY,GZ),(GX+.40,GY-.09,GZ),.018,wood[1])
verts=[];faces=[];n=24;rows=13
for layer in [0,1]:
    for j in range(rows):
        t=j/(rows-1);center=Vector((GX-.08-t*.12,GY+.08-t*.21,GZ+.14+t*.73));r=.026+.24*(t**2.1)-(0.007 if layer else 0)
        for i in range(n):
            a=i*2*pi/n;rr=r*(1+.035*sin(i*3+j));verts.append(tuple(center+Vector((rr*cos(a),rr*sin(a)*.80,rr*sin(a)*.30))))
for layer in [0,1]:
    offset=layer*rows*n
    for j in range(rows-1):
        for i in range(n):a=offset+j*n+i;b=offset+j*n+(i+1)%n;quad=(a,b,b+n,a+n);faces.append(quad if layer==0 else quad[::-1])
for i in range(n):a=(rows-1)*n+i;b=(rows-1)*n+(i+1)%n;faces.append((a,b,b+rows*n,a+rows*n))
mesh=bpy.data.meshes.new('Dented gramophone horn');mesh.from_pydata(verts,[],faces);o=bpy.data.objects.new('Dented verdigris gramophone horn',mesh);bpy.context.collection.objects.link(o);finish(o,o.name,verdigris)
# Supporting stacked boxes keep it among the jumble rather than on a display plinth.
crate(GX,GY,.04,.64,.59,.70)
for i in range(3):stack_book(GX+.10,GY,.77+i*.045,.46,.42,.04,.13-i*.06)
# An old bowed instrument leans at an angle by the far partition.
IX,IY,IZ=-1.25,2.47,.72
for dx,dz,rx,rz in [(-.04,.0,.16,.21),(.02,.25,.135,.17)]:sphere('Old bowed instrument body',(IX+dx,IY,IZ+dz),(rx,.045,rz),wood[5])
rod('Instrument long neck',(IX+.02,IY,IZ+.35),(IX+.11,IY,IZ+.95),.028,wood[0])
for i in range(4):curve('Unplayed instrument string',[(IX-.035+i*.013,IY-.049,IZ-.13),(IX+.085+i*.005,IY-.035,IZ+.91)],.0007,bronze)
for z in [.82,.88]:rod('Instrument tuning peg',(IX+.075,IY-.055,IZ+z),(IX+.14,IY+.06,IZ+z),.009,dark)
rod('Old bow leaning nearby',(IX+.21,IY-.02,.21),(IX+.34,IY,1.70),.006,wood[1])
# Keys, each a little different, hang beside the door.
for i in range(7):
    x=1.02+i*.055;y=2.55-random.uniform(0,.02);z=1.64+random.uniform(-.09,.09)
    torus('Unlabelled old key ring',(x,y,z),.025,.005,bronze,rot=(pi/2,0,0))
    rod('Unlabelled old key shank',(x,y,z-.02),(x,y,z-.14),.006,rust)
    for dz in [.0,.022]:cube('Old key tooth',(x+.014,y,z-.14+dz),(.035,.012,.008),rust)
curve('Key hook cord',[(1.02,2.55,1.79),(1.17,2.55,1.72),(1.36,2.55,1.76)],.007,ropeMat)
# A small balance with crooked pans hides among the paperwork.
SX,SY,SZ=-2.32,1.12,.80
crate(SX,SY,.04,.63,.58,.66)
cyl('Balance heavy base',(SX,SY,SZ),.14,.035,bronze,20)
rod('Balance upright',(SX,SY,SZ),(SX,SY,SZ+.48),.013,bronze)
rod('Crooked balance beam',(SX-.26,SY,SZ+.46),(SX+.26,SY,SZ+.50),.010,bronze)
for side in [-1,1]:
    cx=SX+side*.24;zz=SZ+.15+side*.02
    for i in range(3):
        a=i*2*pi/3;rod('Balance pan hanging wire',(cx,SY,SZ+.48+side*.02),(cx+.11*cos(a),SY+.11*sin(a),zz),.003,bronze)
    bpy.ops.mesh.primitive_cone_add(vertices=20,radius1=.055,radius2=.12,depth=.035,location=(cx,SY,zz));finish(bpy.context.object,'Crooked tarnished balance pan',bronze)
# Leaning frames and piles behind the entry give the room foreground and a lived-in back.
for x,y,z,w,h,angle in [(-2.0,-6.83,.70,.72,1.16,.12),(2.73,-6.61,.54,.59,.85,-.15),(-2.80,5.05,1.25,.50,.70,.09)]:
    for sx in [-1,1]:
        o=cube('Battered empty picture frame',(x+sx*w/2,y,z),(.045,.045,h),wood[1],.006);o.rotation_euler[1]=angle
    for sz in [-1,1]:cube('Battered empty frame crosspiece',(x,y,z+sz*h/2),(w,.045,.045),wood[2],.006)
    cube('Dark tarnished mirror plate',(x,y+.02,z),(w-.06,.008,h-.07),bronze)
# Rolls, bundles and books have accumulated above the shelves, too.
for x,y,z in [(-2.70,-4.5,2.76),(-2.67,-1.15,2.45),(2.66,-3.9,2.63),(2.60,.6,2.86),(-2.6,6.0,2.67)]:
    for i in range(3):stack_book(x+random.uniform(-.05,.05),y+random.uniform(-.05,.05),z+i*.045,.35,.47,.04,random.uniform(-.22,.22))
for x,y,z in [(2.64,1.95,.16),(-2.86,-3.2,.22),(-2.73,4.6,.18)]:
    for i in range(3):cyl('Rolled faded textile',(x+i*.09,y,z+i*.03),.065,.69,random.choice([cloth,clothRust,clothBlue]),14,rot=(pi/2,0,.09))
# Forgotten maps spill over a crate; these use genuine foxed paper texture.
for i in range(5):
    x=1.64+random.uniform(-.08,.08);y=-1.48+random.uniform(-.07,.07);z=.90+i*.007
    o=cube('Loose old map sheet',(x,y,z),(.51,.38,.003),foxedPaper);o.rotation_euler[2]=random.uniform(-.24,.24)
crate(1.69,-1.50,.04,.62,.57,.77)
print('Dense cellar bazaar clutter built',flush=True)

# The back table is made from rough planks and iron brackets.
for i in range(5):cube('Far table weathered top plank',(-.90+i*.45,5,.89),(.443,1.60,.115),wood[2+i%4],.010)
for x in [-.91,.91]:
    for y in [4.4,5.6]:
        o=cube('Far table rough leg',(x,y,.43),(.10,.10,.80),wood[1],.008);o.rotation_euler[1]=.025 if x>0 else -.025
for y in [4.39,5.61]:cube('Far table rough apron',(0,y,.72),(1.98,.06,.23),wood[0],.005)
for x in [-1.0,1.0]:cube('Table rusted iron bracket',(x,4.37,.77),(.08,.016,.17),rust)
# A volume that has survived centuries of handling, damp, repair and neglect.
BX,BY,BZ=0,4.92,1.052
bw,bl=.86,1.11

def cover_warp(x,y):
    u=x/(bw/2);v=(y-BY)/(bl/2)
    return .0035*sin(u*8+v*3)+.0028*sin(v*13-u*4)+.010*(abs(u)**9)*(.4+.6*sin(v*4+1))+.006*(abs(v)**10)*sin(u*5-.4)
def cover_top(x,y):return BZ+.081+cover_warp(x,y)
def warped_cover(name,z,m,parent=None):
    nx,ny=25,33;verts=[];faces=[]
    for layer in [0,1]:
        for j in range(ny+1):
            v=j/ny;yy=BY+(v-.5)*(bl+.035)
            for i in range(nx+1):
                u=i/nx;xx=BX+(u-.5)*(bw+.035)
                # Corners are rounded away and nibbled into by worn rawhide.
                corner=max(0,(abs(u-.5)-.39)/.11)*max(0,(abs(v-.5)-.39)/.11)
                xx-=math.copysign(.014*corner,xx if xx else 1);yy-=math.copysign(.017*corner,yy-BY if yy!=BY else 1)
                zz=z+(.016 if layer else -.016)+cover_warp(xx,yy)
                verts.append((xx-BX,yy-BY,zz-z))
    stride=(nx+1)*(ny+1)
    for layer in [0,1]:
        for j in range(ny):
            for i in range(nx):
                a=layer*stride+j*(nx+1)+i;quad=(a,a+1,a+nx+2,a+nx+1);faces.append(quad if layer else quad[::-1])
    boundary=list(range(nx+1))+[j*(nx+1)+nx for j in range(1,ny+1)]+[ny*(nx+1)+i for i in range(nx-1,-1,-1)]+[j*(nx+1) for j in range(ny-1,0,-1)]
    for a,b in zip(boundary,boundary[1:]+boundary[:1]):faces.append((a,b,b+stride,a+stride))
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update();uv=mesh.uv_layers.new(name='Leather UV')
    for p in mesh.polygons:
        for li in p.loop_indices:
            v=mesh.vertices[mesh.loops[li].vertex_index].co;uv.data[li].uv=(v.x/(bw+.035)+.5,v.y/(bl+.035)+.5)
        p.use_smooth=True
    o=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(o);o.location=(BX,BY,z);return finish(o,name,m,parent)
warped_cover('Book lower warped leather board',BZ-.072,ancientLeather)
# Each leaf has its own offset and ragged edge; the top remains readable.
for layer in range(34):
    z=BZ-.058+layer*.00287;w=bw-.047+random.uniform(-.009,.009);l=bl-.047+random.uniform(-.010,.010)
    pts=[]
    for edge in range(4):
        for k in range(12):
            t=k/12;jitter=random.uniform(-.004,.004)
            if edge==0:x=-w/2+t*w;y=-l/2+jitter
            elif edge==1:x=w/2+jitter;y=-l/2+t*l
            elif edge==2:x=w/2-t*w;y=l/2+jitter
            else:x=-w/2+jitter;y=l/2-t*l
            pts.append((BX+.015+x,BY+y,z))
    vertices=pts+[(x,y,zz+.0025) for x,y,zz in pts];n=len(pts);faces=[tuple(range(n-1,-1,-1)),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    mesh=bpy.data.meshes.new('Deckled rag paper leaf');mesh.from_pydata(vertices,[],faces);uv=mesh.uv_layers.new(name='Paper UV')
    for p in mesh.polygons:
        for li in p.loop_indices:
            co=mesh.vertices[mesh.loops[li].vertex_index].co;uv.data[li].uv=((co.x-BX)/bw+.5,(co.y-BY)/bl+.5)
    o=bpy.data.objects.new('Irregular darkened page',mesh);bpy.context.collection.objects.link(o);finish(o,o.name,foxedPaper if layer==33 else random.choice(pageEdgeMats))
# A softened, cracked spine retains a few uneven raised cords.
spine=cube('Ancient collapsed leather spine',(BX-bw/2-.012,BY,BZ-.006),(.066,bl+.012,.165),ancientLeather,.023)
for i,y in enumerate([-.43,-.23,.19,.40]):
    o=cube('Frayed spine binding cord',(BX-bw/2-.040,BY+y,BZ-.008),(.019,.022+random.uniform(-.005,.007),.145),rawhide,.006);o.rotation_euler[0]=.035*(-1 if i%2 else 1)
hinge=bpy.data.objects.new('BookCoverHinge',None);bpy.context.collection.objects.link(hinge);hinge.location=(BX-bw/2,BY,BZ+.056)
hinge['purpose']='glTF local Z rotation 0 to +2.75 radians opens the ancient leather cover.'
bpy.context.view_layer.update()
cover=warped_cover('Book front leather cover',BZ+.065,ancientLeather,parent=hinge)
# Only fragments remain of one thin gilt border. No polished studs or metal corner pieces.
for edge in range(4):
    for k in range(10):
        if random.random()<.42:continue
        t0=k/10+.015;t1=(k+1)/10-.012;points=[]
        for t in [t0,(t0+t1)/2,t1]:
            if edge==0:x=-bw/2+.060+t*(bw-.120);y=BY-bl/2+.060
            elif edge==1:x=bw/2-.060;y=BY-bl/2+.060+t*(bl-.120)
            elif edge==2:x=bw/2-.060-t*(bw-.120);y=BY+bl/2-.060
            else:x=-bw/2+.060;y=BY+bl/2-.060-t*(bl-.120)
            points.append((x,y,cover_top(x,y)+.0009))
        curve('Surviving fragment of gilt tooling',points,.0011,oldGilt,parent=hinge)
# The same title survives as very faint, partly rubbed lettering.
for name,body,y,size in [('Cover publisher','LEGACY AI SOLUTIONS',.25,.034),('Cover title line one','BOOK OF',.08,.047),('Cover title line two','IMMUTABLE',-.04,.055),('Cover title line three','TRUTHS',-.16,.062)]:
    o=text(name,body,(BX,BY+y,BZ+.085),size,fadedTitle,parent=hinge)
    bpy.context.view_layer.update();mw=o.matrix_world.copy();inv=mw.inverted()
    for v in o.data.vertices:
        co=mw@v.co;co.z=cover_top(co.x,co.y)+.0007;v.co=inv@co
# Deep fissures run inward from the dried edges, alongside baked fine cracking.
for i in range(19):
    side=random.choice([-1,1]);x=side*(bw/2-.021);y=BY+random.uniform(-.48,.48);pts=[]
    for j in range(random.randint(3,6)):
        x-=side*random.uniform(.013,.035);y+=random.uniform(-.018,.018);pts.append((x,y,cover_top(x,y)+.0010))
    curve('Desiccated leather fissure',pts,.0008,dark,parent=hinge)
# A small hand-sewn repair, with uneven thread loops and raw exposed corners.
patch=[(.19,BY-.40),(.33,BY-.41),(.36,BY-.29),(.29,BY-.245),(.17,BY-.29)]
verts=[(x,y,cover_top(x,y)+.002) for x,y in patch];mesh=bpy.data.meshes.new('Irregular old leather repair');mesh.from_pydata(verts,[],[tuple(range(len(verts)))]);o=bpy.data.objects.new('Hand-sewn rawhide repair',mesh);bpy.context.collection.objects.link(o);finish(o,o.name,rawhide,hinge)
for a,b in zip(patch,patch[1:]+patch[:1]):
    for t in [.15,.4,.68,.88]:
        x=a[0]*(1-t)+b[0]*t;y=a[1]*(1-t)+b[1]*t;dx=b[0]-a[0];dy=b[1]-a[1];norm=max(.001,(dx*dx+dy*dy)**.5);ox=-dy/norm*.004;oy=dx/norm*.004
        curve('Uneven old repair stitch',[(x-ox,y-oy,cover_top(x-ox,y-oy)+.002),(x,y,cover_top(x,y)+.004),(x+ox,y+oy,cover_top(x+ox,y+oy)+.002)],.0009,stitchMat,parent=hinge)
for i in range(27):
    x=random.uniform(-.37,.38);y=BY-bl/2+random.uniform(-.008,.008)
    curve('Frayed leather fiber',[(x,y,cover_top(x,y)),(x+random.uniform(-.008,.008),y-random.uniform(.008,.018),cover_top(x,y)-random.uniform(.002,.007))],.00055,rawhide,parent=hinge)
# Physical Chapter One. The supplied opening text is preserved exactly.
text('Physical chapter number','CHAPTER ONE',(BX+.025,BY+.385,BZ+.041),.019,leather)
text('Opening page publisher','LEGACY AI SOLUTIONS',(BX+.025,BY+.28,BZ+.041),.022,leather)
text('Opening page heading','WHAT SOFTWARE',(BX+.025,BY+.13,BZ+.041),.034,leather)
text('Opening page heading two','OWES YOU',(BX+.025,BY+.06,BZ+.041),.038,leather)
text('Opening page byline',"Douglas’s Oath To This Work",(BX+.025,BY-.04,BZ+.041),.019,leather)
text('Opening page invitation','Everyone. Because everyone',(BX+.025,BY-.19,BZ+.041),.019,leather)
text('Opening page invitation two','is a beginner somewhere.',(BX+.025,BY-.235,BZ+.041),.019,leather)
for y in [-.31,-.33]:cube('Opening page worn rule',(BX+.025,BY+y,BZ+.041),(.36,.0007,.0007),oldGilt)
cube('Frayed burgundy bookmark',(BX+.22,BY-.43,BZ-.078),(.029,.53,.003),rug)
for i in range(8):curve('Bookmark frayed end',[(BX+.207+i*.0036,BY-.695,BZ-.078),(BX+.207+i*.0036+random.uniform(-.003,.003),BY-.715-random.random()*.013,BZ-.08)],.0006,rug)
print('Ancient articulated book built',flush=True)

# A single small task lamp leaves the volume ordinary until someone chooses it.
light_positions=[]
def lantern(x,y,z,r=.15,h=.42):
    cyl('Old hanging lantern base',(x,y,z),r+.025,.04,bronze,20)
    for i in range(6):
        a=i*2*pi/6;rod('Lantern black iron frame',(x+r*cos(a),y+r*sin(a),z),(x+r*cos(a),y+r*sin(a),z+h),.007,bronze)
    sphere('Lantern stained amber glass',(x,y,z+h*.48),(r*.84,r*.84,h*.42),shade)
    bpy.ops.mesh.primitive_cone_add(vertices=20,radius1=r+.035,radius2=.04,depth=.13,location=(x,y,z+h+.04));finish(bpy.context.object,'Lantern dented roof',bronze)
    rod('Lantern chain',(x,y,z+h+.1),(x,y,3.04),.005,bronze)
    sphere('Lantern small bulb',(x,y,z+h*.45),(.035,.035,.06),lightMat)
    light_positions.append((x,y,z+h*.45))
lantern(-1.55,-4.47,2.24,.14,.36)
lantern(1.46,.63,2.35,.13,.30)
lantern(-1.30,6.65,2.25,.14,.34)
cyl('Back table old lamp base',(-.81,5.66,.97),.125,.036,bronze,20)
rod('Old lamp crooked stem',(-.81,5.66,.99),(-.86,5.66,1.30),.018,bronze)
bpy.ops.mesh.primitive_cone_add(vertices=24,radius1=.18,radius2=.08,depth=.18,location=(-.86,5.66,1.40));finish(bpy.context.object,'Faded small table lampshade',shade)
sphere('Table lamp warm bulb',(-.86,5.66,1.32),(.046,.046,.04),lightMat)
light_positions.append((-.86,5.66,1.31))
for i in range(3):stack_book(.77,5.43,.98+i*.055,.38,.50,.05,.04-i*.07)
# A dusty ordinary clock is almost lost amongst the objects.
CX,CY,CZ=.17,8.11,2.62
cyl('Battered shop clock',(CX,CY,CZ),.26,.075,wood[1],32,rot=(pi/2,0,0))
cyl('Dirty old clock face',(CX,CY-.045,CZ),.229,.008,cream,32,rot=(pi/2,0,0))
for i in range(12):
    a=i*2*pi/12;rod('Clock tick',(CX+.199*sin(a),CY-.053,CZ+.199*cos(a)),(CX+.215*sin(a),CY-.053,CZ+.215*cos(a)),.003,dark)
rod('Clock minute hand',(CX,CY-.057,CZ),(CX-.18,CY-.057,CZ),.004,dark)
a=2*pi*4.75/12;rod('Clock hour hand',(CX,CY-.060,CZ),(CX+.125*sin(a),CY-.060,CZ+.125*cos(a)),.006,dark)
text('Clock label','SUNDAY',(CX,CY-.053,CZ-.08),.018,dark,rotation=(pi/2,0,0))
# Warm low practical lights with a cooler shadow tone, nothing supernatural.
for i,p in enumerate(light_positions):
    d=bpy.data.lights.new('Old practical lamp %02d'%i,'POINT');d.energy=32 if p[2]>2 else 13;d.color=(1,.72,.44);d.shadow_soft_size=.20
    o=bpy.data.objects.new(d.name,d);bpy.context.collection.objects.link(o);o.location=p
for loc,energy,size,target,col in [((0,-4,2.9),27,3,(0,-1,1),(.72,.80,.66)),((0,4.2,2.9),28,2,(0,5,1),(1,.76,.50))]:
    d=bpy.data.lights.new('Dim dusty room bounce','AREA');d.energy=energy;d.shape='DISK';d.size=size;d.color=col
    o=bpy.data.objects.new(d.name,d);bpy.context.collection.objects.link(o);o.location=loc;o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler()
vol=bpy.data.materials.new('Ordinary stale dusty air');vol.use_nodes=True;n=vol.node_tree.nodes;n.clear();out=n.new('ShaderNodeOutputMaterial');v=n.new('ShaderNodeVolumePrincipled');v.inputs['Density'].default_value=.014;v.inputs['Color'].default_value=(.30,.34,.27,1);v.inputs['Anisotropy'].default_value=.2;vol.node_tree.links.new(v.outputs['Volume'],out.inputs['Volume'])
atm=cube('Render-only dust',(0,.5,1.6),(6.1,15.5,3.1),vol,join=False);atm.hide_viewport=True
bpy.ops.object.camera_add(location=(0,-6.75,1.60));camera=bpy.context.object;camera.name='Curiosity shop entry';camera.rotation_euler=(Vector((.04,3.3,1.40))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=27
scene=bpy.context.scene;scene.camera=camera;scene.render.engine='CYCLES';scene.cycles.samples=32;scene.cycles.use_denoising=True
scene.render.resolution_x=1600;scene.render.resolution_y=1000;scene.render.resolution_percentage=100
scene.world.color=(.015,.019,.013);scene.view_settings.view_transform='AgX';scene.view_settings.look='AgX - Medium High Contrast';scene.view_settings.exposure=.25
scene.render.image_settings.file_format='PNG';scene.render.filepath=ASSET+'/poster.png'
scene['asset_story']='Sunday 4:45. A cramped unassuming cellar bazaar; a centuries-worn book is only one possible discovery.'
scene['book_age_profile']='Warped cracked desiccated leather, worn gilt, repaired seams and irregular deckled pages.'
scene['runtime_coordinates']='Blender (x,y,z) -> Three.js (x,z,-y). Entrance [0,1.6,6.75]; book [0,1.052,-4.92].'
# Combine the attached repairs, worn lettering and cracks into one articulated detail mesh.
for o in scene.objects:
    if o.type=='MESH' and len(o.data.uv_layers)==1:
        o.data.uv_layers[0].name='UVMap'
bpy.ops.object.select_all(action='DESELECT')
decor=[o for o in bpy.data.objects if o.parent==hinge and o!=cover and o.type=='MESH']
for o in decor:o.select_set(True)
if decor:
    bpy.context.view_layer.objects.active=decor[0];bpy.ops.object.join();bpy.context.object.name='AncientBookCoverDetails'
bpy.ops.object.select_all(action='DESELECT')
for o in static:
    if o and o.name in bpy.data.objects and o.type=='MESH':o.select_set(True)
bpy.context.view_layer.objects.active=bpy.context.selected_objects[0];bpy.ops.object.join();merged=bpy.context.object;merged.name='OldCuriosityShop'
bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.remove_doubles(threshold=.00005);bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.wm.save_as_mainfile(filepath=ART+'/antique-bookstore.blend',compress=True)
bpy.ops.object.select_all(action='DESELECT')
for o in scene.objects:
    if o.type=='MESH' and o!=atm:o.select_set(True)
    if o==hinge:o.select_set(True)
bpy.ops.export_scene.gltf(filepath=ASSET+'/bookstore.glb',export_format='GLB',use_selection=True,export_apply=True,export_yup=True,export_lights=False,export_cameras=False,export_materials='EXPORT',export_texcoords=True,export_normals=True)
meta={'blender_version':bpy.app.version_string,'scene':'Dingy cellar bazaar with ancient repaired leather book','coordinate_conversion':'Blender x,y,z → glTF x,z,-y','entrance':[0,1.6,6.75],'book_center':[BX,BZ,-BY],'table_center':[0,.89,-5],'doorway':{'center':[0,1.1,-2.82],'width':1.40,'height':2.24},'book_cover_hinge':{'node':'BookCoverHinge','position':[BX-bw/2,BZ+.056,-BY],'gltf_axis':'Z','open_rotation_radians':2.75,'closed_rotation_radians':0},'lamp_positions_gltf':[[x,z,-y] for x,y,z in light_positions],'alcoves':{'cabinet_of_oddities':[-2.17,1,-.1],'atlas':[2.01,1.18,-.82]},'book_dimensions':{'width':bw,'length':bl,'thickness':.17},'hotspots':{'gramophone':[1.73,1.5,4.65],'bowed_instrument':[-1.25,1.15,-2.47],'hanging_keys':[1.20,1.5,-2.55],'old_balance':[-2.32,1.1,-1.12],'loose_maps':[1.64,.95,1.48]},'poster':'dist/assets/poster.png'}
with open(ART+'/scene-metadata.json','w') as f:json.dump(meta,f,indent=2)
print('ANCIENT_CELLAR_EXPORTED',json.dumps(meta),flush=True)
bpy.ops.render.render(write_still=True)
# Inspect the closed ancient volume, then prove its opening.
camera.location=(.95,3.49,2.27);camera.rotation_euler=(Vector((-.13,4.92,1.06))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=43
scene.render.resolution_x=1300;scene.render.resolution_y=1000;scene.render.filepath=ART+'/ancient-book-closed.png';bpy.ops.render.render(write_still=True)
# One open-cover render verifies that the genuine hinge exposes the opening page.
hinge.rotation_euler[1]=-2.75
camera.location=(.95,3.49,2.27);camera.rotation_euler=(Vector((-.13,4.92,1.06))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=43
scene.render.resolution_x=1300;scene.render.resolution_y=1000;scene.render.filepath=ART+'/book-open.png';bpy.ops.render.render(write_still=True)
print('ANCIENT_CELLAR_COMPLETE',flush=True)
