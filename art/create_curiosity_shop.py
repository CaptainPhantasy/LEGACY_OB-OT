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


book_vertices=[];book_faces=[];book_materials=[];book_material_index=[]
def book_spine(x,y,z,w,h,d,rotation=0):
    col=random.choice(bookmats)
    def part(n,l,s,m):
        if m not in book_materials:book_materials.append(m)
        mi=book_materials.index(m);vstart=len(book_vertices)
        for dx,dy,dz in [(-1,-1,-1),(-1,-1,1),(-1,1,-1),(-1,1,1),(1,-1,-1),(1,-1,1),(1,1,-1),(1,1,1)]:
            lx=l[0]+dx*s[0]/2;ly=l[1]+dy*s[1]/2;lz=l[2]+dz*s[2]/2
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

# The back table is made from rough planks and iron brackets.
for i in range(5):cube('Far table weathered top plank',(-.90+i*.45,5,.89),(.443,1.60,.115),wood[2+i%4],.010)
for x in [-.91,.91]:
    for y in [4.4,5.6]:
        o=cube('Far table rough leg',(x,y,.43),(.10,.10,.80),wood[1],.008);o.rotation_euler[1]=.025 if x>0 else -.025
for y in [4.39,5.61]:cube('Far table rough apron',(0,y,.72),(1.98,.06,.23),wood[0],.005)
for x in [-1.0,1.0]:cube('Table rusted iron bracket',(x,4.37,.77),(.08,.016,.17),rust)
# Signature volume. The hinge remains an independent glTF node for animation.
BX,BY,BZ=0,4.92,1.052
bw,bl=.86,1.11
cube('Book lower leather cover',(BX,BY,BZ-.072),(bw+.035,bl+.035,.032),leather,.014)
cube('Book gilded page block',(BX+.018,BY,BZ-.013),(bw-.047,bl-.045,.102),pageLight,.01)
for i in range(17):
    z=BZ-.057+i*.0052
    cube('Individual aged page edge',(BX+.041,BY-bl/2+.021,z),(bw-.09,.006,.0014),pageDark)
    cube('Fore-edge page strata',(BX+bw/2-.008,BY,z),(.004,bl-.06,.0014),pageDark)
# closed volume spine held to the lower body
cube('Leather rounded book spine',(BX-bw/2-.01,BY,BZ-.005),(.054,bl+.018,.17),leather,.025)
for y in [-.41,-.24,.24,.41]:cube('Raised book spine rib',(BX-bw/2-.036,BY+y,BZ-.005),(.018,.028,.162),leatherTop,.009)
hinge=bpy.data.objects.new('BookCoverHinge',None);bpy.context.collection.objects.link(hinge);hinge.location=(BX-bw/2,BY,BZ+.056)
hinge['purpose']='Animate local Y rotation from 0 to -2.75 radians in Blender; in glTF rotate local Z from 0 to +2.75. Spine pivot at left edge.'
bpy.context.view_layer.update()
cover=cube('Book front leather cover',(BX,BY,BZ+.065),(bw+.035,bl+.035,.032),leather,.014,parent=hinge)
# Leather inset rectangles and gold tooling lie above the cover plane.
for inset,thick,mm in [(.035,.006,gold),(.058,.003,goldbright),(.10,.003,leatherTop)]:
    x0=BX-bw/2+inset;x1=BX+bw/2-inset;y0=BY-bl/2+inset;y1=BY+bl/2-inset
    curve('Gilt rectangular cover tooling',[(x0,y0,BZ+.083),(x1,y0,BZ+.083),(x1,y1,BZ+.083),(x0,y1,BZ+.083)],thick,mm,parent=hinge,cyclic=True)
for sx in [-1,1]:
    for sy in [-1,1]:
        cx=BX+sx*(bw/2-.10);cy=BY+sy*(bl/2-.10)
        for r in [.026,.05]:
            pts=[(cx+sx*r*cos(t),cy+sy*r*sin(t),BZ+.085) for t in [i*pi/2/12 for i in range(13)]]
            curve('Gilded corner flourish',pts,.004,goldbright,parent=hinge)
        sphere('Cover corner brass stud',(BX+sx*(bw/2-.035),BY+sy*(bl/2-.035),BZ+.085),(.012,.012,.004),goldbright,parent=hinge)
# Embossed title faces the visitor at the entrance (Blender negative Y).
text('Cover publisher','LEGACY AI SOLUTIONS',(BX,BY+.25,BZ+.085),.041,goldbright,parent=hinge)
text('Cover title line one','BOOK OF',(BX,BY+.08,BZ+.085),.060,goldbright,parent=hinge)
text('Cover title line two','IMMUTABLE',(BX,BY-.04,BZ+.085),.068,goldbright,parent=hinge)
text('Cover title line three','TRUTHS',(BX,BY-.16,BZ+.085),.082,goldbright,parent=hinge)
# Small gilt compass star as a discovery emblem.
for a in range(8):
    t=a*pi/4;r=.065 if a%2==0 else .04
    rod('Cover star ray',(BX,BY-.34,BZ+.085),(BX+r*cos(t),BY-.34+r*sin(t),BZ+.085),.0026,goldbright,parent=hinge)
torus('Cover star ring',(BX,BY-.34,BZ+.085),.026,.0027,goldbright,parent=hinge)
# First page is legible in the close-up before the reading interface takes over.
text('Opening page publisher','LEGACY AI SOLUTIONS',(BX+.025,BY+.28,BZ+.041),.022,leather)
text('Opening page heading','WHAT SOFTWARE',(BX+.025,BY+.13,BZ+.041),.034,leather)
text('Opening page heading two','OWES YOU',(BX+.025,BY+.06,BZ+.041),.038,leather)
text('Opening page byline',"Douglas’s Oath To This Work",(BX+.025,BY-.04,BZ+.041),.019,leather)
text('Opening page invitation','Everyone. Because everyone',(BX+.025,BY-.19,BZ+.041),.019,leather)
text('Opening page invitation two','is a beginner somewhere.',(BX+.025,BY-.235,BZ+.041),.019,leather)
for y in [-.31,-.33]:cube('Opening page rule',(BX+.025,BY+y,BZ+.041),(.36,.001,.001),gold)
# Loose ribbon extends from the antique page block.
cube('Burgundy bookmark',(BX+.22,BY-.43,BZ-.078),(.034,.53,.004),rug)

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
scene=bpy.context.scene;scene.camera=camera;scene.render.engine='CYCLES';scene.cycles.samples=24;scene.cycles.use_denoising=True
scene.render.resolution_x=1600;scene.render.resolution_y=1000;scene.render.resolution_percentage=100
scene.world.color=(.015,.019,.013);scene.view_settings.view_transform='AgX';scene.view_settings.look='AgX - Medium High Contrast';scene.view_settings.exposure=.10
scene.render.image_settings.file_format='PNG';scene.render.filepath=ASSET+'/poster.png'
scene['asset_story']='Sunday 4:45. A cramped unassuming secondhand and curiosity shop; the book is only one possible discovery.'
scene['runtime_coordinates']='Blender (x,y,z) -> Three.js (x,z,-y). Entrance [0,1.6,6.75]; book [0,1.052,-4.92].'
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
meta={'blender_version':bpy.app.version_string,'scene':'Cramped old curiosity shop, no recliner, no carpet, no grand arches','coordinate_conversion':'Blender x,y,z → glTF x,z,-y','entrance':[0,1.6,6.75],'book_center':[BX,BZ,-BY],'table_center':[0,.89,-5],'doorway':{'center':[0,1.1,-2.82],'width':1.40,'height':2.24},'book_cover_hinge':{'node':'BookCoverHinge','position':[BX-bw/2,BZ+.056,-BY],'gltf_axis':'Z','open_rotation_radians':2.75,'closed_rotation_radians':0},'lamp_positions_gltf':[[x,z,-y] for x,y,z in light_positions],'alcoves':{'cabinet_of_oddities':[-2.17,1,-.1],'atlas':[2.01,1.18,-.82]},'book_dimensions':{'width':bw,'length':bl,'thickness':.17},'poster':'dist/assets/poster.png'}
with open(ART+'/scene-metadata.json','w') as f:json.dump(meta,f,indent=2)
print('CURIOSITY_SHOP_EXPORTED',json.dumps(meta),flush=True)
bpy.ops.render.render(write_still=True)
# One open-cover render verifies that the genuine hinge exposes the opening page.
hinge.rotation_euler[1]=-2.75
camera.location=(.95,3.49,2.27);camera.rotation_euler=(Vector((-.13,4.92,1.06))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=43
scene.render.resolution_x=1300;scene.render.resolution_y=1000;scene.render.filepath=ART+'/book-open.png';bpy.ops.render.render(write_still=True)
print('CURIOSITY_SHOP_COMPLETE',flush=True)
