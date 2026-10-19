import {expect,it,vi,afterEach} from 'vitest';
import {lattice,textSeed,seededRandom,paintField} from '../../src/js/spine-surface.js';
import {seededRandom as original,paintField as originalPaint} from './helpers/reference-book-cloth.js';
const hash=text=>{let h=2166136261;for(let i=0;i<text.length;i++)h=Math.imul(h^text.charCodeAt(i),16777619);return h>>>0};
const noise=(i,j,salt)=>{let h=Math.imul(i*374761393+j*668265263+salt*1442695041|0,1274126177);h=Math.imul(h^h>>>13,1103515245);return ((h^h>>>16)>>>0)/4294967296};
it('preserves UTF-16 hash identity including unpaired surrogates',()=>{
 for(const text of ['', 'Hello', '東京', '😀', '\ud800', 'x\udc00', 'ñandú', 'x'.repeat(4097)])expect(textSeed(text)).toBe(hash(text));
});
it('preserves batches across zero, wrapping, signed and fractional seed values',()=>{
 for(const seed of [undefined,null,NaN,Infinity,-Infinity,0,-0,1,-1,1.5,0xffffffff,0x100000000,1e20]){
  const a=seededRandom(seed),b=original(seed);for(let n=0;n<1025;n++)expect(a()).toBe(b());
 }
});
it('preserves lattice floating point arithmetic before JS int32 truncation',()=>{
 for(const i of [-1e10,-123,-.5,0,.2,1,65535,1e10,NaN])for(const j of [-40,0,9,2.7])for(const salt of [-3,0,23])expect(lattice(i,j,salt)).toBe(noise(i,j,salt));
});

afterEach(()=>vi.unstubAllGlobals());
it('native field generation preserves pixels and the consumed random cursor across batch boundaries',()=>{
 let output;
 vi.stubGlobal('document',{createElement:()=>({getContext:()=>({createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData:image=>{output=image.data.slice()}})})});
 const c={save(){},restore(){},drawImage(){}};
 for(const seed of [0,1,-1,2147483648])for(const channel of [undefined,'g']){
  const a=seededRandom(seed),b=original(seed);for(let n=0;n<67;n++)expect(a()).toBe(b());
  const options={cells:[7,24],spread:24,channel};
  paintField(c,180,1024,a,options);const actual=output;
  originalPaint(c,180,1024,b,options);expect(actual).toEqual(output);
  for(let n=0;n<130;n++)expect(a()).toBe(b());
 }
});

it('preserves consumed state and the same canvas error when painting fails',()=>{
 vi.stubGlobal('document',{createElement:()=>({getContext:()=>({createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData(){}})})});
 const failure=Error('Canvas lost'),c={save(){},restore(){},drawImage(){throw failure}};
 const a=seededRandom(23),b=original(23);
 expect(()=>paintField(c,180,1024,a)).toThrow(failure);expect(()=>originalPaint(c,180,1024,b)).toThrow(failure);
 for(let n=0;n<100;n++)expect(a()).toBe(b());
});
