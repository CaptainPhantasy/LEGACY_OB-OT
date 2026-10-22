import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ShopSound} from '../dist/sound.js';

function harness(t){
  const previousDocument=globalThis.document;
  const events=[],nodes=[];
  globalThis.document={hidden:false,addEventListener(){},removeEventListener(){},dispatchEvent(event){events.push(event);}};
  t.after(()=>{globalThis.document=previousDocument;});
  const param=()=>({value:0,calls:[],setValueAtTime(...args){this.calls.push(['set',...args]);},linearRampToValueAtTime(...args){this.calls.push(['ramp',...args]);}});
  function node(kind){
    const n={kind,connections:[],disconnects:0,connect(target){this.connections.push(target);return target;},disconnect(){this.disconnects++;}};
    nodes.push(n);return n;
  }
  const sound=new ShopSound();
  sound.context={state:'running',currentTime:10,
    createBufferSource(){return Object.assign(node('source'),{playbackRate:param(),starts:[],stops:[],start(...args){this.starts.push(args);},stop(...args){this.stops.push(args);}});},
    createBiquadFilter(){return Object.assign(node('filter'),{frequency:param()});},
    createGain(){return Object.assign(node('gain'),{gain:param()});},
    createPanner(){return Object.assign(node('panner'),{setPosition(...position){this.position=position;}});},
    async decodeAudioData(bytes){return{duration:2.544,bytes:bytes.byteLength};},
    async suspend(){this.state='suspended';},
  };
  sound.master=node('master');sound.reverb=node('reverb');sound.buffers.owner={duration:2.544};
  return{sound,nodes,events,doc:globalThis.document};
}

test('the shopkeeper call obeys mute, hidden-page, autoplay, and unavailable-recording states',t=>{
  const{sound,nodes,events,doc}=harness(t);
  assert.equal(sound.ownerCall(),false,'initially muted calls cannot start audio');
  sound.enabled=true;sound.context.state='suspended';assert.equal(sound.ownerCall(),false,'a suspended browser is never resumed by the call');
  sound.context.state='running';doc.hidden=true;assert.equal(sound.ownerCall(),false);
  doc.hidden=false;delete sound.buffers.owner;assert.equal(sound.ownerCall(),false);
  assert.equal(nodes.filter(n=>n.kind==='source').length,0);assert.equal(events.length,0);
});

test('the audible call comes from around the corner with a clear voice and restrained room echo',t=>{
  const{sound,nodes,events}=harness(t);sound.enabled=true;
  assert.equal(sound.ownerCall(),true);
  const source=nodes.find(n=>n.kind==='source'),panner=nodes.find(n=>n.kind==='panner'),filter=nodes.find(n=>n.kind==='filter');
  assert.deepEqual(panner.position,[2.4,1.6,6.1]);assert.equal(panner.panningModel,'HRTF');
  assert.equal(panner.refDistance,3);assert.equal(panner.rolloffFactor,.35);
  assert.equal(filter.type,'lowpass');assert.equal(filter.frequency.value,3800);
  const send=nodes.find(n=>n.kind==='gain'&&n.connections.includes(sound.reverb));assert.equal(send.gain.value,.22);
  assert.ok(panner.connections.includes(sound.master),'the dry voice stays directly audible');
  assert.equal(source.playbackRate.value,1,'the generated voice is not unnaturally slowed');
  assert.deepEqual(source.starts,[[10,0,2.544]]);assert.equal(sound.active.get(source).category,'owner');
  assert.deepEqual(events[0].detail,{name:'owner',category:'owner',duration:2.544});
});

test('replaying the call replaces the previous voice, and muting stops it immediately',async t=>{
  const{sound,nodes}=harness(t);sound.enabled=true;
  sound.ownerCall();const first=nodes.find(n=>n.kind==='source');
  sound.ownerCall();const second=nodes.filter(n=>n.kind==='source')[1];
  assert.equal(sound.active.has(first),false);assert.equal(sound.active.has(second),true);
  assert.equal(first.stops.at(-1).length,0,'the previous voice is stopped now rather than overlapping');
  assert.equal(sound.active.size,1);
  await sound.setEnabled(false);
  assert.equal(second.stops.at(-1).length,0);assert.equal(sound.active.size,0);assert.equal(sound.context.state,'suspended');
});

test('the owner recording loads locally and is included in audio readiness',async t=>{
  const{sound}=harness(t),previousFetch=globalThis.fetch,requests=[];
  t.after(()=>{globalThis.fetch=previousFetch;});
  delete sound.buffers.owner;
  for(const key of ['page','steps','leather','bus'])sound.buffers[key]={duration:1};
  assert.deepEqual(sound.status.missing,['owner']);
  globalThis.fetch=async url=>{
    requests.push(url);const bytes=await readFile(url);
    return{ok:true,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};
  };
  await sound.loadRecordings();
  assert.equal(requests.length,1);assert.ok(requests[0].pathname.endsWith('/dist/assets/audio/shop-owner-closing.mp3'));
  assert.equal(requests[0].protocol,'file:','the test resolves the bundled asset; playback needs no voice service');
  assert.equal(sound.buffers.owner.bytes,40704);assert.equal(sound.status.recordedReady,true);assert.equal(sound.status.loading,false);
});
