import {expect,it,vi,afterEach} from 'vitest';
import {lattice,textSeed} from '../../src/js/spine-surface.js';
import {shelfStream as seededRandom,shelfField as paintField} from './helpers/shelf-stream.js';
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

// A spine prints its numbers natively (font sizes, channel bytes, the alpha of every rubbed fibre): each must
// be the text a template literal gives, for whole numbers, plain decimals and what the engine prints itself.
it('prints numbers exactly as a template literal does',async()=>{
 const {rustShelf}=await import('./helpers/rust-shelf-ready.js');
 const same=value=>{const text=rustShelf.spine_number_text(value);if(text!==`${value}`)throw new Error(`${Object.is(value,-0)?'-0':value}: ${text} / ${`${value}`}`);};
 for(const value of [0,-0,1,-1,.5,-.5,.1,.2,.1+.2,1/3,2/3,1e-6,9.999999e-7,1e-7,1.5e-7,123456789.125,1e20,1e21,1.5e21,123456789012345680000,2**53,2**53-1,2**53+2,-(2**53),
  4.35,.012,.0425,.24,44,43.99999999999999,64.00000000000001,5e-324,Number.MAX_VALUE,Number.MIN_VALUE,Number.EPSILON,NaN,Infinity,-Infinity,255,200,150,110,184,.16*.999,1e-6+Number.EPSILON])same(value);
 let seed=20261114;const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 const bits=new DataView(new ArrayBuffer(8));
 for(let n=0;n<300000;n++){
  // Alphas and sizes as a spine computes them, short decimals, magnitudes across the exponent switch, raw bit patterns.
  same(next()*.16);same(.012+next()*.03);same(4+next()*22);same(Math.round(next()*1e6)/1000);same((next()-.5)*10**Math.floor(next()*40-12));
  bits.setUint32(0,next()*4294967296>>>0);bits.setUint32(4,next()*4294967296>>>0);same(bits.getFloat64(0));
  // Whole numbers of 2^-k: where the exact text is one decimal longer than the shortest, two texts are equally near.
  same(Math.floor(next()*2**(1+Math.floor(next()*53)))/2**Math.floor(next()*70));
 }
 for(const value of [-2010910219978541.2,2010910219978541.2,123456789.001953125,4503599627370496.5,2251799813685248.25,2251799813685248.75,1125899906842624.125])same(value);
},120_000);
