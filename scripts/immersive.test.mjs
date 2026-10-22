import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import {setupImmersive} from '../dist/immersive.js';

function harness({standard=true,prefixed=false,standalone=false,apple=false,reject=false,failExit=false}={}){
  const elements=new Map(),listeners=new Map(),classes=new Set(),calls=[],messages=[];
  const el=id=>{if(!elements.has(id))elements.set(id,{hidden:false,textContent:'',attrs:{},setAttribute(name,value){this.attrs[name]=value;}});return elements.get(id);};
  const doc={fullscreenElement:null,webkitFullscreenElement:null,fullscreenEnabled:true,webkitFullscreenEnabled:true,
    body:{classList:{toggle(name,value){if(value)classes.add(name);else classes.delete(name);}}},
    querySelector:el,addEventListener(name,fn){listeners.set(name,fn);},documentElement:{}};
  const win={navigator:{userAgent:apple?'Mozilla/5.0 (iPhone)':'Chrome',maxTouchPoints:apple?5:0},matchMedia(query){return{matches:standalone&&query==='(display-mode: standalone)',addEventListener(){}};}};
  if(standard)doc.documentElement.requestFullscreen=options=>{
    calls.push(['enter',options]);
    if(reject)return Promise.reject(new Error('Blocked'));
    doc.fullscreenElement=doc.documentElement;listeners.get('fullscreenchange')?.();return Promise.resolve();
  };
  if(prefixed)doc.documentElement.webkitRequestFullscreen=()=>{
    calls.push(['webkit-enter']);doc.webkitFullscreenElement=doc.documentElement;listeners.get('webkitfullscreenchange')?.();
  };
  doc.exitFullscreen=()=>{
    calls.push(['exit']);if(failExit)return Promise.reject(new Error('Cannot exit'));
    doc.fullscreenElement=null;doc.webkitFullscreenElement=null;listeners.get('fullscreenchange')?.();return Promise.resolve();
  };
  const api=setupImmersive({doc,win,announce:message=>messages.push(message)});
  return{api,doc,win,el,calls,messages,classes,listeners};
}

test('loading never requests fullscreen; entry requests hidden browser bars before returning its promise',async()=>{
  const h=harness();assert.equal(h.calls.length,0);
  const result=h.api.enter();assert.deepEqual(h.calls,[['enter',{navigationUI:'hide'}]],'request is synchronous in the entry tap');
  assert.equal(await result,true);assert.ok(h.classes.has('immersive'));
  assert.match(h.el('#fullscreen').textContent,/Return to the browser/);
});

test('a visitor exiting fullscreen is not immediately forced back by another entry or navigation',async()=>{
  const h=harness();await h.api.enter();await h.api.toggle();
  assert.equal(h.doc.fullscreenElement,null);
  await h.api.enter();await h.api.enter();assert.equal(h.calls.filter(c=>c[0]==='enter').length,1);
  await h.api.toggle();assert.equal(h.calls.filter(c=>c[0]==='enter').length,2,'explicit fullscreen button still works');
});

test('Safari-prefixed support is used without requiring the standard method',async()=>{
  const h=harness({standard:false,prefixed:true});
  assert.equal(await h.api.enter(),true);assert.deepEqual(h.calls,[['webkit-enter']]);
  assert.ok(h.classes.has('immersive'));await h.api.toggle();assert.equal(h.doc.webkitFullscreenElement,null);
});

test('a refused fullscreen request keeps navigation available and explains the Home Screen alternative',async()=>{
  const h=harness({reject:true,apple:true});
  assert.equal(await h.api.enter(),false);assert.equal(h.el('#fullscreen-help').hidden,false);
  assert.match(h.el('#fullscreen-help').textContent,/kept its bars visible/);
  assert.match(h.el('#fullscreen-help').textContent,/Share → Add to Home Screen/);
  assert.match(h.el('#fullscreen-help').textContent,/Open as Web App/);
  assert.equal(h.messages.length,1);assert.ok(!h.classes.has('immersive'));
  await h.api.enter();assert.equal(h.calls.length,1,'there is no automatic rejection loop');
});

test('unsupported browsers receive accurate instructions without a broken fullscreen call',async()=>{
  const h=harness({standard:false,apple:true});
  assert.match(h.el('#fullscreen').textContent,/How to hide/);
  assert.match(h.el('#fullscreen-help').textContent,/Home Screen/);
  assert.equal(await h.api.enter(),false);assert.equal(h.calls.length,0);
});

test('a Home Screen launch starts with the immersive layout and needs no additional fullscreen request',async()=>{
  const h=harness({standalone:true});
  assert.equal(h.el('#fullscreen').hidden,true);assert.equal(h.el('#fullscreen-intro-note').hidden,true);
  assert.equal(await h.api.enter(),true);assert.equal(h.calls.length,0);assert.ok(h.classes.has('immersive'));
});

test('a synchronous browser failure and a failed exit are handled without stopping the shop',async()=>{
  const h=harness();h.doc.documentElement.requestFullscreen=()=>{throw new Error('Permission required');};
  assert.equal(await h.api.enter(),false);assert.match(h.messages[0],/kept its bars/);
  const second=harness({failExit:true});await second.api.enter();assert.equal(await second.api.toggle(),true);
  assert.match(second.messages[0],/exit control/);
});

test('manifest launch and icons remain portable to a subdirectory, and the document exposes a real clock',async()=>{
  const manifest=JSON.parse(await readFile(new URL('../dist/manifest.webmanifest',import.meta.url),'utf8'));
  for(const name of ['id','start_url','scope'])assert.equal(manifest[name],'./');
  assert.equal(manifest.display,'standalone');assert.deepEqual(manifest.display_override,['fullscreen','standalone']);
  for(const icon of manifest.icons){assert.ok(icon.src.startsWith('./'));await access(new URL(`../dist/${icon.src}`,import.meta.url));}
  const html=await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
  assert.match(html,/<time id="shop-clock"/);assert.match(html,/id="shop-day"/);
  assert.ok(!html.includes('FIFTEEN MINUTES TO CLOSE'));assert.ok(!html.includes('SUNDAY AFTERNOON'));
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,new Set(ids).size);
});
