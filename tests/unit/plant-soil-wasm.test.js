// @vitest-environment node
import {readFileSync} from 'node:fs';
import {beforeAll,expect,it,vi} from 'vitest';
import {rustPlantSoilRows} from '../../src/js/plant-soil-wasm.js';
import {soilPainter} from './helpers/reference-plant-soil.js';
let core;
beforeAll(async()=>{core=(await WebAssembly.instantiate(readFileSync('src/wasm/inhouse_read_core.wasm'))).instance.exports;expect(typeof core.plant_soil_rows).toBe('function');});
const styles=[{kind:0},{kind:1}];
function expected(w,h,style){
 const paint=soilPainter(style.kind===0?'peat':'grit');const pigment=new Uint8Array(w*h*4),data=new Uint8Array(pigment.length),texel=[0,0,0,.5,1];
 const byte=v=>Math.round(255*Math.min(1,Math.max(0,v)));
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  paint((x+.5)/w,(y+.5)/h,x,y,texel);const at=(y*w+x)*4;
  for(let c=0;c<3;c++)pigment[at+c]=byte(texel[c]);pigment[at+3]=data[at+3]=255;data[at]=byte(texel[3]);data[at+1]=byte(texel[4]);
 }
 return{pigment,data};
}
for(const [w,h] of [[7,11],[128,256],[256,512]])for(let i=0;i<styles.length;i++)it(`matches peat/gravel pixels ${w}×${h}/${i}`,()=>{
 const style=styles[i],ref=expected(w,h,style),pigment=new Uint8Array(w*h*4),data=new Uint8Array(pigment.length);
 for(let row=0;row<h;row+=4)expect(rustPlantSoilRows(core,style.kind,w,h,row,Math.min(4,h-row),pigment,data)).toBe(true);
 expect(Buffer.from(pigment).equals(Buffer.from(ref.pigment))).toBe(true);expect(Buffer.from(data).equals(Buffer.from(ref.data))).toBe(true);
});
it('writes only requested rows, refreshing views after memory growth',()=>{
 const w=17,h=31,ref=expected(w,h,styles[0]),pigment=new Uint8Array(w*h*4).fill(42),data=new Uint8Array(pigment.length).fill(39),free=vi.fn(core.free_f64);
 const engine={...core,free_f64:free,plant_soil_rows(...a){core.memory.grow(1);return core.plant_soil_rows(...a);}};
 expect(rustPlantSoilRows(engine,styles[0].kind,w,h,7,3,pigment,data)).toBe(true);expect(free).toHaveBeenCalledOnce();
 for(let y=0;y<h;y++)for(let k=0;k<w*4;k++){
  const at=y*w*4+k;expect(pigment[at]).toBe(y>=7&&y<10?ref.pigment[at]:42);expect(data[at]).toBe(y>=7&&y<10?ref.data[at]:39);
 }
});
it('rejects invalid or overflowing parameters before altering textures',()=>{
 const pigment=new Uint8Array(8*8*4).fill(42),data=pigment.slice();
 for(const kind of [-1,2,NaN])expect(rustPlantSoilRows(core,kind,8,8,0,4,pigment,data)).toBe(false);
 for(const [row,count]of[[-1,4],[0,5],[7,2],[0,0]])expect(rustPlantSoilRows(core,0,8,8,row,count,pigment,data)).toBe(false);
 expect(pigment.every(v=>v===42)).toBe(true);expect(data.every(v=>v===42)).toBe(true);
});
it.each([()=>0,()=>{throw Error('kernel');}])('releases rejected row jobs',kernel=>{
 const free=vi.fn(core.free_f64),pigment=new Uint8Array(256);
 expect(rustPlantSoilRows({...core,free_f64:free,plant_soil_rows:kernel},0,8,8,0,4,pigment,pigment.slice())).toBe(false);expect(free).toHaveBeenCalledOnce();
});
