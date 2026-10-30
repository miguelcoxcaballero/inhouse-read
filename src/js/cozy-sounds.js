// Web Audio transport. Rust names each event's recorded clips (cozy_clip), synthesises a fallback (cozy_sound)
// and reports the real contact events; no oscillator, polling loop or audio context runs on an idle shelf.
// The clip atlas (src/assets/sfx: 16-bit PCM plus an index) is fetched once after the first gesture; until it has
// loaded, or if it cannot load (offline without a cached copy), every event uses the synthesised sound.
import {needRustShelf} from './rust-shelf.js';
const KEY='inhouse-read-shelf-sounds',RETRY_MS=60000;
// Vite gives both recordings and their index immutable hashed URLs. An older
// offline shell cannot pair a new index with its cached low-bandwidth binary.
const ATLAS_BIN=new URL('../assets/sfx/atlas.bin',import.meta.url).href;
const ATLAS_INDEX=new URL('../assets/sfx/atlas.json',import.meta.url).href;
let muted=false,state=null,core=null;
let atlasState='idle',atlasRetry=0;
// The recordings and the caches Rust (cozy_atlas.rs) reads: groups of takes, routes, last takes, buffers.
const store={ready:false,samples:null,groups:new Map(),routes:new Map(),lastTake:new Map(),buffers:new Map()};
try{muted=localStorage.getItem(KEY)==='off';}catch{}
// The first shelf already awaits Rust. Settings can bind before that bootstrap,
// without constructing a context or making the module a startup dependency.
const engine=()=>core??=needRustShelf();
const transport=()=>state??=engine().cozy_transport_new(muted);
const persistPreference=()=>{try{localStorage.setItem(KEY,muted?'off':'on');}catch{}};
const host={
 global:globalThis,document,ignore:()=>{},loadAtlas,clearBuffers:()=>store.buffers.clear(),persistPreference,
 // A random recorded take of the most specific atlas group, or the synthesised sound.
 buffer:(audio,kind,material,level,variant)=>engine().cozy_atlas_buffer(needRustShelf(),store,audio,kind,material,level,variant),
 park:()=>engine().cozy_transport_park(host,state),idle:()=>engine().cozy_transport_idle(host,state),
 unlockFailed:()=>engine().cozy_transport_failed(host,state,false),playFailed:()=>engine().cozy_transport_failed(host,state,true),
 primeEnded:source=>()=>engine().cozy_transport_prime_ended(source),
 voiceEnded:voice=>()=>engine().cozy_transport_voice_ended(host,state,voice),
 attachment:registration=>({
  gesture:event=>engine().cozy_transport_gesture(host,state,event),
  hidden:()=>engine().cozy_transport_hidden(host,state),pageHidden:()=>engine().cozy_transport_stop(host,state),
  dispose:()=>engine().cozy_transport_dispose(host,state,registration),
 }),
};
export const shelfSoundsEnabled=()=>state?engine().cozy_transport_enabled(host,state):false;
/** The level an event is rendered at: soft under 0.33, medium under 0.66, otherwise hard. */
export const shelfSoundLevel=strength=>engine().cozy_transport_level(strength);
/** Index the atlas as groups of takes (`book_set_wood_t0`… belong to `book_set_wood`), keeping only valid clips. */
export const indexShelfSoundAtlas=(index,samples)=>engine().cozy_atlas_index(index,samples);
function loadAtlas(){
 if(atlasState==='loading'||atlasState==='ready'||atlasState==='failed'&&Date.now()<atlasRetry||typeof fetch!=='function')return;
 atlasState='loading';
 const get=(url,read)=>fetch(url).then(response=>{if(!response.ok)throw Error(`HTTP ${response.status}`);return read(response);});
 Promise.all([get(ATLAS_INDEX,response=>response.json()),get(ATLAS_BIN,response=>response.arrayBuffer())]).then(([index,bin])=>{
  const samples=new Int16Array(bin,0,bin.byteLength>>1),found=indexShelfSoundAtlas(index,samples.length);
  if(!found.size)throw Error('empty sound atlas');
  store.groups=found;store.samples=samples;store.routes.clear();store.ready=true;atlasState='ready';
 }).catch(()=>{atlasState='failed';atlasRetry=Date.now()+RETRY_MS;});
}
export function unlockShelfSounds(){if(state)engine().cozy_transport_unlock(host,state);}
export function playShelfSound(kind,material=0,strength=1,pan=0){if(state)engine().cozy_transport_play(host,state,kind,material,strength,pan);}
export function setShelfSoundsEnabled(enabled){
 muted=!enabled;
 if(state)engine().cozy_transport_muted(host,state,muted);else persistPreference();
}
export function attachShelfSounds(root){
 if(!root)return()=>{};
 return engine().cozy_transport_attach(host,transport(),root);
}
export const shelfSoundPreference=()=>!muted;

export function bindShelfSoundPreference(document){
 const input=document.getElementById('shelf-sounds-toggle');if(!input)return()=>{};
 input.checked=shelfSoundPreference();const changed=()=>setShelfSoundsEnabled(input.checked);
 input.addEventListener('change',changed);return()=>input.removeEventListener('change',changed);
}
