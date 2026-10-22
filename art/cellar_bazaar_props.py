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
