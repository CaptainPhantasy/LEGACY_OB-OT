// Assemble shaders through the delivered Three implementation, then compile and
// link them with an existing EGL/GLES driver. Texture pixels are not decoded;
// actual scene geometry, material settings, UV channels and shader hooks are used.
import {readFile} from 'node:fs/promises';
import {registerHooks} from 'node:module';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const threeURL=new URL('../dist/vendor/three.module.js',import.meta.url).href;
registerHooks({resolve(specifier,context,next){return specifier==='three'?{url:threeURL,shortCircuit:true}:next(specifier,context);}});
const THREE=await import(threeURL);
const [{GLTFLoader},{RoomRenderer},{RoomRadiance},{applyRoomLightmap},{enhanceMaterials},{ShopStorefront},{applyStreetSurfaces,applyStreetGroundAO},{RoomAtmosphere}]=await Promise.all([
  import('../dist/vendor/loaders/GLTFLoader.js'),import('../dist/room-renderer.js'),import('../dist/room-radiance.js'),import('../dist/room-lightmap.js'),
  import('../dist/room-materials.js'),import('../dist/shop-storefront.js'),import('../dist/street-surfaces.js'),import('../dist/room-atmosphere.js')]);
const vendor=await readFile(new URL(threeURL),'utf8');
const stop='const glVertexShader = WebGLShader( gl, gl.VERTEX_SHADER, vertexGlsl );';
if(!vendor.includes(stop))throw new Error('The delivered shader assembler changed; update validation explicitly.');
const assembly=vendor.replaceAll("'./three.core.js'",JSON.stringify(new URL('../dist/vendor/three.core.js',import.meta.url).href))
  .replace(stop,'return {vertex:vertexGlsl,fragment:fragmentGlsl};\n'+stop)+'\nexport {WebGLProgram,WebGLPrograms};';
const {WebGLProgram,WebGLPrograms}=await import('data:text/javascript;base64,'+Buffer.from(assembly).toString('base64'));
const oldLoad=THREE.TextureLoader.prototype.load,oldAsync=THREE.TextureLoader.prototype.loadAsync,oldFetch=globalThis.fetch,oldSelf=globalThis.self,oldProgress=globalThis.ProgressEvent,oldDPR=globalThis.devicePixelRatio;
const imageSizes=new Map();
for(const name of ['room','curiosity']){const manifest=JSON.parse(await readFile(new URL(`../dist/assets/${name}-lightmap.json`,import.meta.url),'utf8'));imageSizes.set(manifest.file||`${name}-lightmap.png`,manifest.resolution);}
let room;
try{
  globalThis.self={URL};globalThis.devicePixelRatio=1;
  globalThis.ProgressEvent=class extends Event{constructor(type,values){super(type);Object.assign(this,values);}};
  THREE.TextureLoader.prototype.load=function(_url,onLoad){const texture=new THREE.Texture({width:1024,height:1024});queueMicrotask(()=>onLoad(texture));return texture;};
  THREE.TextureLoader.prototype.loadAsync=async function(url){
    const name=new URL(url,new URL('../dist/',import.meta.url)).pathname.split('/').pop();
    const size=imageSizes.get(name)||1024;
    return new THREE.Texture({width:size,height:size});
  };
  globalThis.fetch=async input=>new Response(await readFile(new URL(input instanceof Request?input.url:input,new URL('../dist/',import.meta.url))));
  const roomURL=new URL('../dist/assets/bookstore-depth.gltf',import.meta.url);
  room=(await new GLTFLoader().parseAsync(await readFile(roomURL,'utf8'),new URL('.',roomURL).href)).scene;
  let currentTarget=null;
  const renderer={capabilities:{getMaxAnisotropy:()=>8},extensions:{has:()=>true},shadowMap:{enabled:true,type:THREE.PCFSoftShadowMap},
    state:{buffers:{depth:{getReversed:()=>false}}},toneMapping:THREE.AgXToneMapping,outputColorSpace:THREE.SRGBColorSpace,
    getRenderTarget:()=>currentTarget,getContext:()=>({createProgram:()=>({})}),getDrawingBufferSize:out=>out.set(1200,800)};
  const scene=new THREE.Scene();scene.fog=new THREE.FogExp2(0x24201a,.024);scene.add(room,new THREE.PointLight(0xffd893,0,12,1.5));
  await enhanceMaterials(room,renderer);await applyRoomLightmap(room,renderer);
  const storefront=new ShopStorefront(scene,room);await applyStreetSurfaces(storefront.root,renderer);await applyStreetGroundAO(storefront.root,renderer);
  const atmosphere=new RoomAtmosphere(scene);
  const radiance=new RoomRadiance(scene,renderer);radiance.bindRoom(room);radiance.setEnvironmentContext({storefront});
  const env=new THREE.Texture({width:768,height:1024});env.mapping=THREE.CubeUVReflectionMapping;
  radiance.reflectionUniforms.roomRearEnvironment.value=env;
  for(const material of radiance.materialBases.keys())if(material.isMeshStandardMaterial){material.envMap=env;radiance.installProjection(material);}
  for(const material of radiance.exteriorBases.keys())material.envMap=env;
  const pipeline=new RoomRenderer(renderer);pipeline.refreshMaterials(scene);
  const lights={directional:[],point:[],spot:[],spotLightMap:[],rectArea:[],hemi:[],directionalShadowMap:[],pointShadowMap:[],spotShadowMap:[],numSpotLightShadowsWithMaps:0,numLightProbes:0},shadows=[];
  scene.traverse(o=>{
    const type=o.isDirectionalLight?'directional':o.isPointLight?'point':o.isSpotLight?'spot':o.isHemisphereLight?'hemi':null;
    if(type)lights[type].push(o);
    if(o.isLight&&o.castShadow){shadows.push(o);lights[type+'ShadowMap'].push(o);}
  });
  const extensions={has:()=>false},capabilities={precision:'highp',getMaxPrecision:value=>value,vertexTextures:true,logarithmicDepthBuffer:false};
  const programs=WebGLPrograms(renderer,{get:v=>v},{get:v=>v},extensions,capabilities,{}, {numPlanes:0,numIntersection:0});
  const assembled=new Map();
  function collect(material,object,label){
    const parameters=programs.getParameters(material,lights,shadows,scene,object);
    const shader={vertexShader:parameters.vertexShader,fragmentShader:parameters.fragmentShader,uniforms:{}};
    material.onBeforeCompile(shader,renderer);Object.assign(parameters,shader);
    const result=WebGLProgram(renderer,'validation',parameters,{});
    const key=(result.vertex+'\n'+result.fragment).replace(/^#define SHADER_NAME .+$/gm,'#define SHADER_NAME VALIDATION');
    if(!assembled.has(key))assembled.set(key,{name:label,...result});
  }
  // Compile both HDR beauty and direct fallback output paths. Transparent blend
  // state is precisely the beauty pass state, including physical glazing.
  for(const direct of [false,true]){
    if(direct)pipeline.restoreMaterials();
    currentTarget=direct?null:pipeline.beauty;
    const restore=direct?()=>{}:pipeline.preserveTransparentMetadata();
    scene.traverse(object=>{if(object.material)for(const material of Array.isArray(object.material)?object.material:[object.material])collect(material,object,`${direct?'direct':'HDR'} / ${material.name||object.name||material.type}`);});
    restore();
  }
  currentTarget=pipeline.occlusion;collect(pipeline.aoMaterial,pipeline.quad,'Post / contact occlusion');
  currentTarget=pipeline.reflection;collect(pipeline.reflectionMaterial,pipeline.quad,'Post / screen reflection');
  currentTarget=null;collect(pipeline.compositeMaterial,pipeline.quad,'Post / final composite');
  console.error(`Compiling ${assembled.size} distinct delivered-scene shader variants with EGL ES3…`);
  const result=spawnSync('python3',[fileURLToPath(new URL('./compile-gles-shaders.py',import.meta.url))],{input:JSON.stringify([...assembled.values()]),encoding:'utf8',maxBuffer:8*1024*1024,timeout:120000});
  if(result.error)throw result.error;
  if(result.stderr)process.stderr.write(result.stderr);
  process.stdout.write(result.stdout);
  pipeline.dispose();radiance.dispose();
  process.exitCode=result.status;
}finally{
  THREE.TextureLoader.prototype.load=oldLoad;THREE.TextureLoader.prototype.loadAsync=oldAsync;globalThis.fetch=oldFetch;
  if(oldSelf===undefined)delete globalThis.self;else globalThis.self=oldSelf;
  if(oldProgress===undefined)delete globalThis.ProgressEvent;else globalThis.ProgressEvent=oldProgress;
  if(oldDPR===undefined)delete globalThis.devicePixelRatio;else globalThis.devicePixelRatio=oldDPR;
}
