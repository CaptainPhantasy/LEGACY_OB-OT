"""Bake static room occlusion and one diffuse bounce using real Embree ray intersections.

Reproduce: python -m pip install numpy pillow trimesh embreex
          python art/bake-room-light.py
The authored GLB is read-only. Animated book covers never enter the static blocker mesh.
"""
from pathlib import Path
import argparse, hashlib, io, json, math, struct, time
import numpy as np
from PIL import Image
import trimesh
from trimesh.ray.ray_pyembree import RayMeshIntersector

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--ao-samples', type=int, default=128)
parser.add_argument('--bounce-samples', type=int, default=64)
args = parser.parse_args()
SOURCE = ROOT/'dist/assets/bookstore.glb'
raw = SOURCE.read_bytes()
json_size, _ = struct.unpack_from('<II', raw, 12)
gltf = json.loads(raw[20:20+json_size])
bin_start = 20+json_size+8
binary = memoryview(raw)[bin_start:]
dtypes = {5120:'i1', 5121:'u1', 5122:'<i2', 5123:'<u2', 5125:'<u4', 5126:'<f4'}
widths = {'SCALAR':1, 'VEC2':2, 'VEC3':3, 'VEC4':4, 'MAT4':16}

def accessor(index):
    a=gltf['accessors'][index]; v=gltf['bufferViews'][a['bufferView']]
    dt=np.dtype(dtypes[a['componentType']]); width=widths[a['type']]
    offset=v.get('byteOffset',0)+a.get('byteOffset',0)
    stride=v.get('byteStride',dt.itemsize*width)
    return np.ndarray((a['count'],width),dt,binary,offset,(stride,dt.itemsize)).copy()

def linear_rgb(rgb):
    return np.where(rgb <= .04045, rgb/12.92, ((rgb+.055)/1.055)**2.4)

def albedo(material):
    p=material.get('pbrMetallicRoughness',{}); c=np.array(p.get('baseColorFactor',[1,1,1,1])[:3])
    if 'baseColorTexture' in p:
        texture=gltf['textures'][p['baseColorTexture']['index']]
        img=gltf['images'][texture['source']]; view=gltf['bufferViews'][img['bufferView']]
        start=view.get('byteOffset',0); im=Image.open(io.BytesIO(binary[start:start+view['byteLength']])).convert('RGB').resize((64,64))
        c=c*linear_rgb(np.asarray(im,dtype=float)/255).mean(axis=(0,1))
    return c*(1-p.get('metallicFactor',1))

node=next(n for n in gltf['nodes'] if n.get('name')=='OldCuriosityShop')
# Source static mesh has translation only. Refuse a changed transform rather than silently bake incorrectly.
assert not any(x in node for x in ('matrix','rotation','scale')), 'Update transform support for changed source.'
translation=np.array(node.get('translation',[0,0,0]))
primitives=gltf['meshes'][node['mesh']]['primitives']
records=[]; positions=[]; normals=[]; triangles=[]; triangle_albedo=[]; vertex_base=0
for pi,p in enumerate(primitives):
    pos=accessor(p['attributes']['POSITION']).astype('f8')+translation
    normal=accessor(p['attributes']['NORMAL']).astype('f8')
    normal/=np.maximum(np.linalg.norm(normal,axis=1,keepdims=True),1e-10)
    material=gltf['materials'][p['material']]; name=material.get('name','')
    records.append({'primitive':pi,'material':name,'count':len(pos),'byteOffset':vertex_base*4})
    positions.append(pos); normals.append(normal)
    # Lamps and cobwebs transmit light; dynamic cover is absent from this static node.
    if not any(term in name.lower() for term in ('glow','glass','bottle','cobweb')):
        inds=accessor(p['indices']).astype('i8').reshape(-1,3)+vertex_base
        triangles.append(inds)
        triangle_albedo.append(np.broadcast_to(albedo(material),(len(inds),3)))
    vertex_base+=len(pos)
positions=np.concatenate(positions); normals=np.concatenate(normals)
faces=np.concatenate(triangles); colors=np.concatenate(triangle_albedo)
mesh=trimesh.Trimesh(vertices=positions,faces=faces,process=False)
ray=RayMeshIntersector(mesh)
face_normals=mesh.face_normals.copy(); plane_point=positions[faces[:,0]]
print(f'Baking {len(positions):,} vertices against {len(faces):,} static triangles',flush=True)

# Stable low-discrepancy, cosine-weighted hemisphere directions; no random bake changes.
up=np.tile([0.,0.,1.],(len(normals),1)); up[np.abs(normals[:,2])>.9]=[0.,1.,0.]
tangent=np.cross(up,normals); tangent/=np.maximum(np.linalg.norm(tangent,axis=1,keepdims=True),1e-10)
bitangent=np.cross(normals,tangent)
origins=positions+normals*.0025
lamps=[([-1.55,2.402,4.47],24),([1.46,2.485,-.63],20),([-1.3,2.403,-6.65],12),([-.86,1.31,-5.66],10)]
lamp_color=linear_rgb(np.array([1.,211/255,160/255]))

# Intersects_first gives triangles; recover the exact nearest intersection distance.
def intersect(orig,dirs):
    ids=ray.intersects_first(orig,dirs)
    valid=ids>=0; dist=np.full(len(orig),np.inf)
    chosen=ids[valid]; denom=np.einsum('ij,ij->i',dirs[valid],face_normals[chosen])
    num=np.einsum('ij,ij->i',plane_point[chosen]-orig[valid],face_normals[chosen])
    dist[valid]=np.divide(num,denom,out=np.full(len(num),np.inf),where=np.abs(denom)>1e-9)
    dist[dist<0]=np.inf
    return ids,dist

def direction(sample,count):
    r=math.sqrt((sample+.5)/count); a=sample*math.pi*(3-math.sqrt(5))
    return tangent*(r*math.cos(a))+bitangent*(r*math.sin(a))+normals*math.sqrt(1-r*r)

start=time.time(); occlusion=np.zeros(len(positions)); bounce=np.zeros_like(positions)
for s in range(args.ao_samples):
    dirs=direction(s,args.ao_samples); _,dist=intersect(origins,dirs)
    # Radius-limited, smooth contact occlusion. Large rooms remain readable.
    occlusion+=np.where(dist<.8,np.exp(-dist/.22),0)
    if (s+1)%16==0: print(f'AO {s+1}/{args.ao_samples}: {time.time()-start:.1f}s',flush=True)
for s in range(args.bounce_samples):
    dirs=direction(s,args.bounce_samples); ids,dist=intersect(origins,dirs)
    indices=np.flatnonzero(dist<3.5)
    hp=origins[indices]+dirs[indices]*dist[indices,None]
    hn=face_normals[ids[indices]].copy()
    hn[np.einsum('ij,ij->i',hn,-dirs[indices])<0]*=-1
    reflected=np.zeros_like(hp)
    for lamp,power in lamps:
        vec=np.asarray(lamp)-hp; distance=np.linalg.norm(vec,axis=1)
        ld=vec/np.maximum(distance[:,None],1e-5)
        cosine=np.maximum(0,np.einsum('ij,ij->i',hn,ld))
        active=np.flatnonzero((cosine>.01)&(distance<8))
        if not len(active):continue
        _,blocking=intersect(hp[active]+hn[active]*.003,ld[active])
        visible=blocking>distance[active]-.015
        # Same distance cutoff as point lights; a diffuse reflection divides irradiance by pi.
        energy=power*cosine[active]/np.maximum(distance[active]**2,.1)
        energy*=np.maximum(1-(distance[active]/8)**4,0)**2
        energy*=visible
        reflected[active]+=energy[:,None]*lamp_color/math.pi
    reflected*=colors[ids[indices]]
    # Capping individual contributions controls a near-lamp firefly without making light appear from nowhere.
    bounce[indices]+=np.minimum(reflected,2.0)
    print(f'Bounce {s+1}/{args.bounce_samples}: {time.time()-start:.1f}s',flush=True)
ao=np.clip(1-.68*occlusion/args.ao_samples,.32,1)
bounce=np.clip(bounce/args.bounce_samples,0,.5)
# Zero emissive AO and bounce: luminous bulbs do not become dirty grey lighting receivers.
for rec in records:
    if any(t in rec['material'].lower() for t in ('glow','glass','cobweb')):
        a=rec['byteOffset']//4; b=a+rec['count']; ao[a:b]=1;bounce[a:b]=0
encoded=np.empty((len(positions),4),dtype='u1')
encoded[:,0]=np.round(ao*255).astype('u1')
encoded[:,1:]=np.round(np.sqrt(bounce/.5)*255).astype('u1')
output=ROOT/'dist/assets/room-irradiance.bin'; output.write_bytes(encoded.tobytes())
metadata={
 'version':1,'sourceSha256':hashlib.sha256(raw).hexdigest(),'dataSha256':hashlib.sha256(encoded.tobytes()).hexdigest(),
 'node':'OldCuriosityShop','encoding':'UNORM8: AO, sqrt(red/0.5), sqrt(green/0.5), sqrt(blue/0.5)',
 'vertexCount':len(positions),'byteLength':encoded.nbytes,'aoSamples':args.ao_samples,'bounceSamples':args.bounce_samples,
 'method':'Embree nearest-surface cosine hemisphere rays, distance-weighted contact occlusion and one Lambertian bounce with four shadow-tested lamps; animated cover excluded',
 'records':records,'summary':{'aoMin':float(ao.min()),'aoMean':float(ao.mean()),'aoMax':float(ao.max()),'bounceMean':bounce.mean(axis=0).tolist(),'bounceMax':bounce.max(axis=0).tolist(),'seconds':round(time.time()-start,2)}
}
(ROOT/'dist/assets/room-irradiance.json').write_text(json.dumps(metadata,indent=2)+'\n')
print(json.dumps(metadata['summary']),flush=True)
print(f'Wrote {encoded.nbytes:,} bytes',flush=True)
