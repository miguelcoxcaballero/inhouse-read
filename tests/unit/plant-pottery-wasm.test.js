// @vitest-environment node
import {readFileSync} from 'node:fs';
import {beforeAll,expect,it,vi} from 'vitest';
import {rustPlantPotteryRows} from '../../src/js/plant-pottery-wasm.js';
import {terracottaPainter,galvanizedPainter} from './helpers/reference-plant-pottery.js';
let core;
beforeAll(async()=>{core=(await WebAssembly.instantiate(readFileSync('src/wasm/inhouse_read_decor.wasm'))).instance.exports;expect(typeof core.plant_pottery_rows).toBe('function');});
const colors=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);
const configFor=o=>new Float64Array([...colors(o.color),o.seed]);
const styles=[{kind:0,color:'#a97958',seed:53},{kind:0,color:'#dbb281',seed:53},{kind:1,color:'#cfd3d5',seed:41},{kind:1,color:'#76a89c',seed:41}];
function expected(w,h,style){
 const paint=style.kind===0?terracottaPainter(style.color,style.seed):galvanizedPainter(style.seed,style.color);const pigment=new Uint8Array(w*h*4),data=new Uint8Array(pigment.length),texel=[0,0,0,.5,1];
 const byte=v=>Math.round(255*Math.min(1,Math.max(0,v)));
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  paint((x+.5)/w,(y+.5)/h,x,y,texel);const at=(y*w+x)*4;
  for(let c=0;c<3;c++)pigment[at+c]=byte(texel[c]);pigment[at+3]=data[at+3]=255;data[at]=byte(texel[3]);data[at+1]=byte(texel[4]);
 }
 return{pigment,data};
}
for(const [w,h] of [[7,11],[128,256],[256,512]])for(let i=0;i<styles.length;i++)it(`matches terracotta/zinc pixels ${w}×${h}/${i}`,()=>{
 const style=styles[i],config=configFor(style),ref=expected(w,h,style),pigment=new Uint8Array(w*h*4),data=new Uint8Array(pigment.length);
 for(let row=0;row<h;row+=4)expect(rustPlantPotteryRows(core,style.kind,w,h,row,Math.min(4,h-row),config,pigment,data)).toBe(true);
 expect(Buffer.from(pigment).equals(Buffer.from(ref.pigment))).toBe(true);expect(Buffer.from(data).equals(Buffer.from(ref.data))).toBe(true);
});
it('writes only requested rows, refreshing views after memory growth',()=>{
 const w=17,h=31,ref=expected(w,h,styles[0]),pigment=new Uint8Array(w*h*4).fill(42),data=new Uint8Array(pigment.length).fill(39),free=vi.fn(core.free_f64);
 const engine={...core,free_f64:free,plant_pottery_rows(...a){core.memory.grow(1);return core.plant_pottery_rows(...a);}};
 expect(rustPlantPotteryRows(engine,styles[0].kind,w,h,7,3,configFor(styles[0]),pigment,data)).toBe(true);expect(free).toHaveBeenCalledOnce();
 for(let y=0;y<h;y++)for(let k=0;k<w*4;k++){
  const at=y*w*4+k;expect(pigment[at]).toBe(y>=7&&y<10?ref.pigment[at]:42);expect(data[at]).toBe(y>=7&&y<10?ref.data[at]:39);
 }
});
it('rejects invalid or overflowing parameters before altering textures',()=>{
 const config=configFor(styles[0]),pigment=new Uint8Array(8*8*4).fill(42),data=pigment.slice();
 for(const value of [NaN,Infinity,-1,1e308]){
  const invalid=config.slice();invalid[0]=value;expect(rustPlantPotteryRows(core,0,8,8,0,4,invalid,pigment,data)).toBe(false);
 }
 for(const [row,count]of[[-1,4],[0,5],[7,2],[0,0]])expect(rustPlantPotteryRows(core,0,8,8,row,count,config,pigment,data)).toBe(false);
 expect(pigment.every(v=>v===42)).toBe(true);expect(data.every(v=>v===42)).toBe(true);
});
it.each([()=>0,()=>{throw Error('kernel');}])('releases rejected row jobs',kernel=>{
 const free=vi.fn(core.free_f64),pigment=new Uint8Array(256);
 expect(rustPlantPotteryRows({...core,free_f64:free,plant_pottery_rows:kernel},0,8,8,0,4,configFor(styles[0]),pigment,pigment.slice())).toBe(false);expect(free).toHaveBeenCalledOnce();
});
