"""East-face curiosity miniatures, built in local metres with front toward -Y.

Executed in build-rabbit-hole-shelf.py's helper namespace.  The assembled props
are symbolic display models, not purported authentic archival artifacts.
"""
import math
from mathutils import Vector


def east_lathe(name, profile, mat, segments=48):
    vertices = []
    for z, radius in profile:
        for i in range(segments):
            angle = i * math.tau / segments
            vertices.append((radius * math.cos(angle), radius * math.sin(angle), z))
    faces = []
    for j in range(len(profile)-1):
        for i in range(segments):
            a = j*segments+i
            b = j*segments+(i+1)%segments
            faces.append((a, b, b+segments, a+segments))
    faces.append(tuple(reversed(range(segments))))
    faces.append(tuple((len(profile)-1)*segments+i for i in range(segments)))
    obj = mesh_obj(name, vertices, faces, mat)
    for poly in obj.data.polygons[:-2]:
        poly.use_smooth = True
    return obj


def east_gear(name, center, radius, teeth=16, mat=None):
    mat = mat or brass
    x, y, z = center
    vertices = []
    for yy in (y-.006, y+.006):
        for j in range(teeth*4):
            a = j*math.tau/(teeth*4)
            r = radius if j%4 in (1,2) else radius*.83
            vertices.append((x+r*math.cos(a), yy, z+r*math.sin(a)))
    n=teeth*4
    # Increasing angle in the XZ plane faces -Y, the front of the exhibit.
    faces=[tuple(range(n)),tuple(n+i for i in reversed(range(n)))]
    faces.extend((i,i+n,(i+1)%n+n,(i+1)%n) for i in range(n))
    mesh_obj(name+' cut brass teeth',vertices,faces,mat)
    cylinder(name+' turned hub',(x,y-.009,z),radius*.21,.010,bronze,(math.pi/2,0,0),24)
    for a in (0,math.pi/2,math.pi,3*math.pi/2):
        rod(name+' engraved spoke',(x,y-.007,z),(x+radius*.68*math.cos(a),y-.007,z+radius*.68*math.sin(a)),.002,dark)


def build_east(index):
    if index == 11:
        # Thick open cloth-bound volume; the raised center and many page edges
        # establish a book silhouette independently of its printed grid.
        box('Babel cloth back cover',(0,0,.008),(.390,.236,.016),cloth,.003)
        box('Babel rounded bound spine',(0,.004,.034),(.029,.229,.061),leather,.006)
        for side in (-1,1):
            x=side*.101
            box('Babel thick ivory page block',(x,0,.043),(.177,.215,.054),paper,.004)
            for k in range(8):
                box('Babel visible individual fore-edge',(x,-.108,.020+k*.0058),(.175,.0012,.0009),foxed,.0001)
            # A gently crowned top leaf has actual curved edges.
            verts=[]
            for y in (-.107,.107):
                for j in range(9):
                    xx=side*(.012+j*.022)
                    zz=.071+.010*math.sin(j/8*math.pi)
                    verts.append((xx,y,zz))
            faces=[(j,j+1,10+j,9+j) for j in range(8)]
            if side < 0:
                faces=[tuple(reversed(face)) for face in faces]
            mesh_obj('Babel bowed top rag-paper leaf',verts,faces,paper)
            for row in range(12):
                content=('qjvt xmrp klan zfey' if row%3==0 else 'zvbg nmqe xokp jfta' if row%3==1 else 'rtiw bcxq aezm uvlp')
                if row==3 and side==-1: content='qjvt meaning zfey'
                if row==8 and side==1: content='time nmqe xokp'
                glyph=lettering('Babel tiny letter grid',content,(x,-.084+row*.015,.082),.0082,dark)
                # Seat each printed glyph on the actual bowed sheet.  Its
                # original small extrusion remains above the paper surface.
                for vertex in glyph.data.vertices:
                    canonical_x=vertex.co.x+glyph.location.x
                    t=max(0.0,min(1.0,(abs(canonical_x)-.012)/.176))
                    surface=.071+.010*math.sin(t*math.pi)
                    vertex.co.z+=surface+.0004-glyph.location.z
        # Ribbon rests over the center rather than floating above the pages.
        box('Babel sewn red bookmark',(0,-.053,.06525),(.009,.128,.0015),red,.0002)

    elif index == 12:
        for x in (-.092,.092):
            box('Computer rubber foot',(x,.027,.005),(.026,.025,.010),dark,.002)
        box('Computer desktop case',(0,.022,.031),(.258,.186,.042),beige,.005)
        box('Computer floppy drive dark slot',(.058,-.072,.033),(.083,.002,.006),dark,.0004)
        box('Computer floppy eject tab',(.100,-.075,.032),(.006,.005,.008),silver,.0004)
        for x in (-.100,-.089,-.078):
            box('Computer front ventilation slit',(x,-.073,.034),(.003,.002,.016),dark,.0003)
        cylinder('Computer power button',(-.041,-.076,.032),.005,.005,bronze,(math.pi/2,0,0),16)
        box('CRT swivel pedestal',(0,.035,.063),(.093,.085,.022),beige,.006)
        box('CRT deep rounded cabinet',(0,.035,.154),(.233,.178,.164),beige,.013)
        box('CRT recessed dark bezel',(0,-.057,.160),(.198,.011,.129),dark,.008)
        box('CRT curved green-grey glass',(0,-.064,.164),(.179,.004,.105),green,.007)
        box('CRT early web page',(0,-.067,.166),(.162,.0008,.088),paper,.001)
        lettering('CRT World Wide Web heading','World Wide Web',(0,-.068,.194),.012,blue,(math.pi/2,0,0))
        for row,text in enumerate(('Information here','What is hypertext?','Getting started','About this project')):
            lettering('CRT early webpage link',text,(-.002,-.068,.177-row*.014),.008,blue,(math.pi/2,0,0))
        for x in (.073,.088):
            cylinder('CRT control knob',(x,-.058,.095),.006,.009,beige,(math.pi/2,0,0),16)
        # Separate keyboard with individual keys; its base touches the shelf.
        box('Computer keyboard shell',(0,-.110,.010),(.252,.063,.020),beige,.004)
        for row in range(3):
            for col in range(13):
                box('Computer individual worn key',(-.111+col*.0185,-.130+row*.017,.023),(.014,.012,.007),paper,.001)
        box('Computer broad spacebar',(0,-.140,.022),(.103,.010,.007),paper,.001)
        for y in (.055,.073,.091):
            box('CRT rear vent',(0,y,.238),(.142,.004,.001),dark,.0003)

    elif index == 13:
        box('Perspective triangle timber plinth',(0,0,.013),(.295,.240,.026),wood_light,.004)
        outer=[(-.122,.060),(.122,.060),(0,.280)]
        centroid=(0,sum(p[1] for p in outer)/3)
        inner=[(x*.60,centroid[1]+(z-centroid[1])*.60) for x,z in outer]
        camera_y,camera_z=-.895,.300
        def at_depth(point,y):
            scale=(y-camera_y)/(-camera_y)
            return (point[0]*scale,y,camera_z+(point[1]-camera_z)*scale)
        for i,y in enumerate((-.047,.008,.063)):
            j=(i+1)%3
            outline=[outer[i],outer[j],inner[j],inner[i]]
            front=[at_depth(p,y) for p in outline]
            back=[(x,yy+.020,z) for x,yy,z in front]
            mesh_obj('Impossible triangle perspective beam',front+back,
                     [(0,1,2,3),(4,7,6,5),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)],brass if i!=1 else bronze)
            mid=tuple((front[0][a]+front[1][a])/2 for a in range(3))
            rod('Hidden illusion beam support',(mid[0],.112,mid[2]),mid,.006,dark)
        for i,p in enumerate(outer):
            q=outer[(i+1)%3]
            rod('Rear triangular support frame',(p[0],.112,p[1]),(q[0],.112,q[1]),.006,dark)
        for x in (-.104,.104):
            rod('Triangle plinth mounting pin',(x,.112,.026),(x,.112,.074),.006,bronze)

    elif index == 14:
        box('Failed wheel demonstrator base',(0,.002,.013),(.293,.198,.026),wood,.004)
        for x in (-.041,.041):
            box('Wheel upright bearing cheek',(x,.042,.109),(.015,.030,.168),wood_light,.003)
        center=(0,-.006,.184)
        rod('Wheel axle',(0,-.070,.184),(0,.074,.184),.008,silver)
        ring('Wheel broad iron rim',center,.118,.007,bronze,(math.pi/2,0,0))
        ring('Wheel inner brass rim',(0,-.009,.184),.104,.0025,brass,(math.pi/2,0,0))
        cylinder('Wheel axle cap',(0,-.024,.184),.017,.024,brass,(math.pi/2,0,0),24)
        for j in range(8):
            a=j*math.tau/8
            x,z=.112*math.cos(a),.184+.112*math.sin(a)
            rod('Wheel radial timber spoke',(0,-.005,.184),(x,-.005,z),.0045,wood_light)
            # Deliberately asymmetric weight travel describes the historical
            # proposal without making the stationary model seem powered.
            r=.092 if math.cos(a)>0 else .057
            wx,wz=r*math.cos(a),.184+r*math.sin(a)
            rod('Wheel hinged weight arm',(x,-.015,z),(wx,-.028,wz),.0025,brass)
            orb('Wheel offset bronze weight',(wx,-.030,wz),(.012,.010,.012),bronze)
        rod('Wheel crank arm',(0,-.065,.184),(.040,-.065,.157),.004,brass)
        rod('Wheel turned wooden crank grip',(.040,-.068,.157),(.040,-.100,.157),.007,wood_light)

    elif index == 15:
        box('Long Now clock shaped base',(0,.002,.014),(.282,.192,.028),wood,.005)
        for x in (-.108,.108):
            rod('Clock tall brass frame',(x,.060,.028),(x,.060,.300),.007,brass)
        rod('Clock frame top rail',(-.108,.060,.300),(.108,.060,.300),.006,brass)
        for x,z,r,n in ((-.052,.115,.052,18),(.043,.151,.044,16),(-.035,.209,.039,14),(.045,.235,.032,12)):
            east_gear('Clock exposed gear',(x,-.006,z),r,n)
            rod('Clock gear bearing pin',(x,-.019,z),(x,.067,z),.004,silver)
            rod('Clock rear bearing strut',(-.108,.060,z),(.108,.060,z),.003,bronze)
        ring('Clock chapter ring',(0,-.029,.209),.086,.004,brass,(math.pi/2,0,0))
        for j in range(12):
            a=j*math.tau/12
            rod('Clock chapter ring hour marker',(.076*math.sin(a),-.031,.209+.076*math.cos(a)),(.084*math.sin(a),-.031,.209+.084*math.cos(a)),.0017,paper)
        rod('Clock minute hand',(0,-.039,.209),(-.050,-.039,.248),.0025,dark)
        rod('Clock hour hand',(0,-.041,.209),(.034,-.041,.223),.0035,dark)
        orb('Clock centered hand hub',(0,-.044,.209),(.006,.004,.006),silver)
        box('Clock five-digit year plate',(0,-.059,.056),(.151,.006,.039),brass,.002)
        lettering('Clock five digit year','02026',(0,-.063,.056),.027,dark,(math.pi/2,0,0))
        rod('Clock hanging pendulum',(0,.071,.189),(0,.071,.058),.0025,brass)
        cylinder('Clock pendulum bob',(0,.071,.058),.022,.008,bronze,(math.pi/2,0,0),24)

    elif index == 16:
        box('Apollo capsule dark display base',(0,0,.013),(.256,.220,.026),dark,.006)
        cylinder('Apollo capsule display post',(0,0,.045),.025,.038,bronze,vertices=32)
        # The curved broad heat shield and truncated cone are closed solids.
        east_lathe('Apollo silver command capsule',[(.063,.105),(.073,.111),(.087,.108),(.228,.031),(.246,.027)],silver,64)
        east_lathe('Apollo dark ablative heat shield',[(.060,.092),(.064,.106),(.073,.110)],dark,64)
        ring('Apollo heat shield rim',(0,0,.078),.108,.0025,bronze)
        ring('Apollo docking collar',(0,0,.248),.028,.004,silver)
        cylinder('Apollo docking recess',(0,0,.249),.020,.007,dark,vertices=32)
        # Front hatch and windows follow the capsule's sloping outer wall.
        hatch=box('Apollo crew hatch',(0,-.068,.156),(.052,.004,.066),bronze,.005)
        hatch.rotation_euler.x=math.radians(28)
        for x in (-.040,.040):
            window=box('Apollo dark trapezoid window',(x,-.055,.189),(.026,.004,.022),dark,.004)
            window.rotation_euler.x=math.radians(28)
            rod('Apollo window aluminum rim',(x-.013,-.061,.178),(x+.013,-.061,.178),.0018,silver)
        for a in (0,math.pi/2,math.pi,3*math.pi/2):
            rod('Apollo capsule panel seam',(.105*math.cos(a),.105*math.sin(a),.086),(.033*math.cos(a),.033*math.sin(a),.225),.0011,bronze)
        for x in (-.084,.084):
            orb('Apollo small reaction-control port',(x,-.049,.108),(.005,.003,.005),dark)

    elif index == 17:
        cylinder('Pangaea globe circular timber foot',(0,0,.012),.089,.024,wood,vertices=48)
        rod('Pangaea globe pedestal',(0,0,.024),(0,0,.067),.010,brass)
        center=Vector((0,0,.188));radius=.101
        orb('Pangaea globe ocean',center,(radius,radius,radius),blue)
        ring('Pangaea globe meridian',(0,0,.188),.114,.004,brass,(math.pi/2,0,0))
        rod('Pangaea globe lower axis',(0,0,.057),(0,0,.088),.004,brass)
        rod('Pangaea globe upper axis',(0,0,.287),(0,0,.304),.004,brass)
        # One connected, approximate Pangaea silhouette.  It is a symbolic
        # geological reconstruction, never a map of modern continents.
        coast=[(-56,49),(-31,65),(-9,58),(8,63),(29,46),(48,42),(54,22),(37,12),(44,-2),(62,-20),(52,-36),(31,-32),(22,-52),(4,-49),(-8,-29),(-23,-43),(-36,-25),(-32,-4),(-48,6),(-64,25)]
        def contains(lon,lat):
            inside=False
            for i,a in enumerate(coast):
                b=coast[(i+1)%len(coast)]
                if (a[1]>lat)!=(b[1]>lat) and lon < (b[0]-a[0])*(lat-a[1])/(b[1]-a[1])+a[0]: inside=not inside
            return inside
        def point(lon,lat,r=radius+.0013):
            lo,la=math.radians(lon),math.radians(lat)
            return (r*math.cos(la)*math.sin(lo),-r*math.cos(la)*math.cos(lo),.188+r*math.sin(la))
        verts=[];faces=[]
        for lon in range(-66,64,4):
            for lat in range(-54,66,4):
                if contains(lon+2,lat+2):
                    i=len(verts);verts.extend((point(lon,lat),point(lon+4,lat),point(lon+4,lat+4),point(lon,lat+4)));faces.append((i,i+1,i+2,i+3))
        land=mesh_obj('Pangaea raised joined continental relief',verts,faces,green)
        for poly in land.data.polygons: poly.use_smooth=True
        for i,a in enumerate(coast):
            b=coast[(i+1)%len(coast)]
            for step in range(4):
                p=(a[0]+(b[0]-a[0])*step/4,a[1]+(b[1]-a[1])*step/4)
                q=(a[0]+(b[0]-a[0])*(step+1)/4,a[1]+(b[1]-a[1])*(step+1)/4)
                rod('Pangaea ochre coastline',point(*p,r=radius+.0018),point(*q,r=radius+.0018),.0007,clay)
        for lat in (-30,0,30):
            for step in range(48):
                a=step*360/48;b=(step+1)*360/48
                rod('Pangaea engraved latitude',point(a,lat,r=radius+.0004),point(b,lat,r=radius+.0004),.00035,brass)

    elif index == 18:
        cylinder('Tree of life weighted round foot',(0,0,.010),.092,.020,wood_light,vertices=40)
        rod('Tree of life twisting trunk',(0,0,.020),(.009,.004,.206),.010,bronze)
        branches=[((.002,0,.080),(-.102,-.018,.165)),((.004,0,.119),(.105,-.006,.193)),((.007,.003,.158),(-.073,.012,.260)),((.009,.004,.188),(.069,.013,.286)),((.009,.004,.197),(.003,-.010,.308))]
        for j,(start,end) in enumerate(branches):
            mid=tuple(start[a]+(end[a]-start[a])*.55 for a in range(3))
            rod('Tree of life curved branch root',start,mid,.0048,bronze)
            rod('Tree of life fine branch tip',mid,end,.0033,brass)
            x,y,z=end
            if j in (0,3):
                # Tiny mushroom silhouettes: stems and actual domed caps.
                rod('Tree of life mushroom stem',(x,y,z-.005),(x,y,z+.021),.003,paper)
                orb('Tree of life mushroom cap',(x,y,z+.023),(.020,.014,.008),red)
                for dx in (-.008,.007): orb('Tree of life mushroom pale spot',(x+dx,y-.011,z+.026),(.002,.0015,.002),paper)
            elif j in (1,4):
                # Almond leaves have thickness, central veins and twig joints.
                leaf=orb('Tree of life bronze-green leaf',(x,y,z+.014),(.013,.004,.026),green)
                leaf.rotation_euler.y=(-.40 if j==1 else .30)
                rod('Tree of life leaf central vein',(x-.003,y-.004,z-.007),(x+.005,y-.004,z+.036),.001,brass)
            else:
                # A deer-like miniature with head, ears and four limbs.
                orb('Tree of life tiny animal body',(x,y,z+.008),(.021,.008,.010),brass)
                orb('Tree of life tiny animal head',(x+.024,y,z+.019),(.009,.006,.008),brass)
                for dx in (-.014,.011):
                    for dy in (-.005,.005):rod('Tree of life tiny animal leg',(x+dx,y+dy,z+.004),(x+dx+.003,y+dy,z-.011),.0018,bronze)
                for dx in (.019,.026):rod('Tree of life tiny animal ear',(x+dx,y,z+.024),(x+dx+.002,y,z+.035),.0018,brass)
        for x in (-.060,.058):
            rod('Tree of life spreading root',(0,0,.027),(x,-.018,.020),.004,bronze)

    elif index == 19:
        # Continuous lathed glass wall avoids stacked overlapping bottle shells.
        east_lathe('Vortex clear single bottle shell',[(.0004,.047),(.005,.059),(.022,.063),(.216,.063),(.239,.054),(.255,.025),(.282,.024),(.285,.021),(.257,.021),(.242,.051),(.215,.059),(.022,.059),(.008,.049)],glass,64)
        cylinder('Vortex sealed cork',(0,0,.289),.021,.025,wood_light,vertices=32)
        ring('Vortex bottle turned bottom rim',(0,0,.008),.057,.0025,glass)
        # Pale funnel opens upward and narrows continuously to a point.
        profile=[]
        for j in range(20):
            z=.030+j*.0092
            r=.003+.048*(j/19)**1.7
            profile.append((z,r))
        funnel=east_lathe('Visible miniature water vortex',profile,water,48)
        for start in (0,math.tau/3,math.tau*2/3):
            previous=None
            for j in range(56):
                t=j/55;z=.034+.170*t;r=.004+.047*t**1.7;a=start+t*math.tau*2.6
                p=(r*math.cos(a),r*math.sin(a),z)
                if previous is not None: rod('Vortex spiral current highlight',previous,p,.0012,paper)
                previous=p
        ring('Vortex calm upper water meniscus',(0,0,.208),.052,.0018,water)

    elif index == 20:
        # Three distinct spread feet support the mount directly on the shelf.
        hip=(0,0,.139)
        for j in range(3):
            a=-math.pi/2+j*math.tau/3
            foot=(.104*math.cos(a),.104*math.sin(a),.006)
            rod('Telescope tripod splayed leg',foot,hip,.0065,bronze)
            orb('Telescope tripod rubber foot',foot,(.012,.010,.006),dark)
            brace=(foot[0]*.55,foot[1]*.55,.070)
            rod('Telescope tripod spreading brace',(0,0,.080),brace,.0025,brass)
        cylinder('Telescope tripod mounting hub',(0,0,.145),.023,.022,brass,vertices=28)
        rod('Telescope fork left cheek',(-.025,0,.149),(-.025,0,.205),.006,bronze)
        rod('Telescope fork right cheek',(.025,0,.149),(.025,0,.205),.006,bronze)
        rod('Telescope altitude axle',(-.035,0,.205),(.035,0,.205),.005,silver)
        direction=Vector((-.78,-.18,.60)).normalized()
        center=Vector((0,0,.220));start=center-direction*.117;end=center+direction*.117
        rod('Telescope cream optical tube',start,end,.032,beige)
        for t in (-.112,.110):
            p=center+direction*t
            cap=cylinder('Telescope brass objective rim',p,.035,.012,brass,vertices=40)
            cap.rotation_euler=direction.to_track_quat('Z','Y').to_euler()
        lens=cylinder('Telescope dark blue objective',end+direction*.007,.028,.003,blue,vertices=40)
        lens.rotation_euler=direction.to_track_quat('Z','Y').to_euler()
        eyepiece=start-direction*.028
        rod('Telescope projecting ocular',start,eyepiece,.013,dark)
        rod('Telescope offset finder mount',(0,.025,.234),(.010,.054,.248),.0035,brass)
        rod('Telescope miniature finder scope',(.055,.055,.219),(-.045,.032,.295),.009,bronze)
        rod('Telescope slow-motion control',(0,.025,.174),(.058,.060,.177),.003,brass)
        orb('Telescope slow-motion knob',(.060,.061,.177),(.009,.009,.009),dark)
    else:
        raise ValueError('East shelf index must be 11 through 20')
