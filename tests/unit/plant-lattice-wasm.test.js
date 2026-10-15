// @vitest-environment node
// The first look of every plant surface: the decor core samples the painter on the 8-pixel lattice and
// spreads it. Compared byte for byte with the frozen JavaScript painters, the lattice sampling loop and the
// bilinear spread (replacing the former test of the spread alone, which took the lattice from the host).
import {readFileSync} from 'node:fs';
import {beforeAll,expect,it,vi} from 'vitest';
import {rustPlantLattice} from '../../src/js/plant-lattice-wasm.js';
import {plantPreview} from './helpers/reference-plant-preview.js';
import {glazedPainter} from './helpers/reference-plant-glaze.js';
import {terracottaPainter,galvanizedPainter} from './helpers/reference-plant-pottery.js';
import {soilPainter} from './helpers/reference-plant-soil.js';
import {botanicalTextures} from './helpers/reference-plant-foliage.js';
let core;
beforeAll(async()=>{core=(await WebAssembly.instantiate(readFileSync('src/wasm/inhouse_read_decor.wasm'))).instance.exports;expect(typeof core.plant_surface_lattice).toBe('function');});
const colors=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);
function hash(x,y,seed){let h=Math.imul(x|0,0x27d4eb2d)^Math.imul(y|0,0x165667b1)^Math.imul(seed|0,0x9e3779b1);h=Math.imul(h^h>>>15,0x85ebca6b);h=Math.imul(h^h>>>13,0xc2b2ae35);return((h^h>>>16)>>>0)/4294967296;}
// The frozen lattice loop of the former surface(): the painter every 8 pixels, stored as f32.
function reference(paint,width,height,repeat){
 const columns=Math.ceil(width/8)+1,rows=Math.ceil(height/8)+1,lattice=new Float32Array(columns*rows*5),texel=[0,0,0,.5,1];
 const sample=(x,y)=>{paint((x+.5)/width,(y+.5)/height,x,y,texel);return texel;};
 for(let j=0;j<rows;j++)for(let i=0;i<columns;i++){
  const x=i*8>=width?repeat?0:width-1:i*8;
  lattice.set(sample(x,Math.min(height-1,j*8)),(j*columns+i)*5);
 }
 return plantPreview(width,height,lattice);
}
// Painters memoise per column, so every use builds its own, as the shelf does.
const glaze=o=>({get paint(){return glazedPainter(o);},spec:{family:0,kind:0,config:new Float64Array([...colors(o.glaze),...colors(o.body),o.gloss,o.speckle,o.crackle,o.seed])}});
const clay=(color,seed)=>({get paint(){return terracottaPainter(color,seed);},spec:{family:1,kind:0,config:new Float64Array([...colors(color),seed])}});
const zinc=(color,seed)=>({get paint(){return galvanizedPainter(seed,color);},spec:{family:1,kind:1,config:new Float64Array([...colors(color),seed])}});
const soil=kind=>({get paint(){return soilPainter(kind);},spec:{family:2,kind:kind==='grit'?1:0}});
const leaf=variant=>{
 const base=colors({zz:'#2f5324',fern:'#4a7a2c',succulent:'#6a8a80',ivy:'#2a4c23',palm:'#3d6c2a',monstera:'#2f6128'}[variant]??'#36672c');
 return{get paint(){return botanicalTextures(variant);},spec:{family:3,kind:variant==='upright'?3:variant==='ivy'?1:variant==='succulent'?2:0,
  config:variant==='upright'?new Float64Array(5):new Float64Array([...base,hash(variant.length,3,11)*Math.PI*2,variant.charCodeAt(0)])}};
};
const styles=[
 glaze({glaze:'#ffffff',body:'#cfbea3',gloss:.24,speckle:.0022,crackle:.55,seed:17}),glaze({glaze:'#76a89c',body:'#cfbea3',gloss:.24,speckle:.0022,crackle:.55,seed:17}),
 glaze({glaze:'#dbacb6',body:'#c7a291',gloss:.42,speckle:.004,crackle:0,seed:29}),glaze({glaze:'#000000',body:'#ffffff',gloss:1,speckle:1,crackle:1,seed:0}),
 clay('#a97958',53),clay('#dbb281',53),zinc('#cfd3d5',41),zinc('#76a89c',41),soil('peat'),soil('grit'),
 ...['zz','fern','succulent','ivy','palm','monstera','leafy','upright'].map(leaf)
];
const sizes=[[1,1],[7,3],[8,8],[9,9],[17,19],[32,256],[128,128],[128,256],[256,256],[256,512],[512,512]];
for(const [w,h] of sizes)for(const repeat of [false,true])it(`draws the same preview bytes for every painter at ${w}×${h}${repeat?' repeating':''}`,()=>{
 for(const [index,style] of styles.entries()){
  const {spec}=style,paint=style.paint;
  const pigment=new Uint8Array(w*h*4).fill(7),data=new Uint8Array(pigment.length).fill(9),expected=reference(paint,w,h,repeat);
  expect(rustPlantLattice(core,spec,w,h,repeat,pigment,data),`style ${index}`).toBe(true);
  expect(Buffer.from(pigment).equals(Buffer.from(expected.pigment)),`style ${index} pigment`).toBe(true);
  expect(Buffer.from(data).equals(Buffer.from(expected.data)),`style ${index} data`).toBe(true);
 }
});
it('keeps matching with pseudo-random glazes, clays and leaf colours',()=>{
 let seed=63891;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 const hex=()=>'#'+[0,1,2].map(()=>Math.floor(random()*256).toString(16).padStart(2,'0')).join('');
 for(let trial=0;trial<60;trial++){
  const w=Math.floor(random()*60)+1,h=Math.floor(random()*90)+1,repeat=trial%2===0;
  const cases=[glaze({glaze:hex(),body:hex(),gloss:random(),speckle:random()*.01,crackle:trial%3?random():0,seed:Math.floor(random()*1000)}),
   clay(hex(),Math.floor(random()*1000)),zinc(hex(),Math.floor(random()*1000))];
  for(const style of cases){
   const {spec}=style,paint=style.paint;
   const pigment=new Uint8Array(w*h*4),data=new Uint8Array(pigment.length),expected=reference(paint,w,h,repeat);
   expect(rustPlantLattice(core,spec,w,h,repeat,pigment,data)).toBe(true);
   expect(Buffer.from(pigment).equals(Buffer.from(expected.pigment))).toBe(true);expect(Buffer.from(data).equals(Buffer.from(expected.data))).toBe(true);
  }
 }
});
it('rejects malformed requests without touching existing texture bytes or allocating',()=>{
 const spec=styles[0].spec,alloc=vi.fn(),engine={...core,alloc_f64:alloc};
 const pigment=new Uint8Array(9*9*4).fill(42),data=pigment.slice();
 for(const args of [[{...spec,family:7},9,9],[spec,0,9],[spec,9,0],[spec,2049,9],[spec,9.5,9],[spec,NaN,9],[{...spec,config:new Float64Array(3)},9,9]])
  expect(rustPlantLattice(engine,...args,false,pigment,data)).toBe(false);
 expect(rustPlantLattice(engine,spec,9,9,false,new Uint8Array(1),data)).toBe(false);expect(rustPlantLattice(engine,spec,9,9,false,pigment,new Uint8Array(1))).toBe(false);
 expect(rustPlantLattice(null,spec,9,9,false,pigment,data)).toBe(false);expect(rustPlantLattice({},spec,9,9,false,pigment,data)).toBe(false);
 expect(alloc).not.toHaveBeenCalled();expect(pigment.every(v=>v===42)).toBe(true);expect(data.every(v=>v===42)).toBe(true);
});
it('declines unusable painter settings in the core and leaves the textures alone',()=>{
 const pigment=new Uint8Array(8*8*4).fill(42),data=pigment.slice();
 for(const [family,kind,length,field,value] of [[0,0,10,0,NaN],[0,0,10,2,1.5],[0,0,10,9,-1],[0,0,10,9,2.5],[1,0,4,0,-.1],[1,2,4,0,.5],[1,0,4,3,1e9],[2,2,0,0,0],[3,0,5,3,7],[3,4,5,0,.5],[3,0,5,4,.5]]){
  const config=new Float64Array(length).fill(.5);if(length)config[length-1]=3;if(length)config[field]=value;
  expect(rustPlantLattice(core,{family,kind,config:length?config:undefined},8,8,false,pigment,data),`${family}/${kind}/${field}`).toBe(false);
 }
 expect(pigment.every(v=>v===42)).toBe(true);expect(data.every(v=>v===42)).toBe(true);
});
it('copies out after memory growth and releases the arena',()=>{
 const {spec,paint}=styles[12],w=128,h=256,expected=reference(paint,w,h,false),free=vi.fn(core.free_f64);
 const engine={...core,free_f64:free,plant_surface_lattice(...input){core.memory.grow(1);return core.plant_surface_lattice(...input);}};
 const pigment=new Uint8Array(w*h*4),data=new Uint8Array(pigment.length);
 expect(rustPlantLattice(engine,spec,w,h,false,pigment,data)).toBe(true);expect(free).toHaveBeenCalledOnce();
 expect(Buffer.from(pigment).equals(Buffer.from(expected.pigment))).toBe(true);expect(Buffer.from(data).equals(Buffer.from(expected.data))).toBe(true);
});
it.each([()=>0,()=>{throw Error('kernel');}])('releases rejected kernels',kernel=>{
 const free=vi.fn(core.free_f64),pigment=new Uint8Array(8*8*4).fill(5),data=pigment.slice();
 expect(rustPlantLattice({...core,free_f64:free,plant_surface_lattice:kernel},styles[0].spec,8,8,false,pigment,data)).toBe(false);expect(free).toHaveBeenCalledOnce();
 expect(pigment.every(v=>v===5)).toBe(true);
});
it('does not grow the WASM heap for repeated previews',()=>{
 const {spec}=styles[4],pigment=new Uint8Array(128*256*4),data=new Uint8Array(pigment.length);
 rustPlantLattice(core,spec,128,256,true,pigment,data);const before=core.memory.buffer.byteLength;
 for(let i=0;i<40;i++)rustPlantLattice(core,spec,128,256,true,pigment,data);
 expect(core.memory.buffer.byteLength).toBe(before);
});
