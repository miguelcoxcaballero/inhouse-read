// @vitest-environment node
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import * as production from '../../src/js/spine-surface.js';
import * as original from './helpers/reference-spine-surface.js';

// The Rust spine (rust-ui/src/spine_surface.rs) is compared with the frozen JavaScript original through
// a recording canvas: every property write, method call, argument (numbers bit for bit), measured width,
// gradient stop and returned value must be identical, in the same order.
const show=value=>{
  if(typeof value==='number')return Object.is(value,-0)?'-0':String(value);
  if(typeof value==='string')return JSON.stringify(value);
  if(value&&value.__canvas)return `canvas#${value.__canvas}`;
  if(value&&value.__gradient)return `gradient#${value.__gradient}`;
  if(value&&value.__image)return `image#${value.__image}`;
  if(value===undefined)return 'undefined';
  if(value===null)return 'null';
  if(typeof value==='boolean')return String(value);
  return JSON.stringify(value);
};
function environment({partial=false}={}){
  const log=[];let canvases=0,gradients=0,images=0;
  const widthOf=(font,text)=>{let h=0;for(const unit of font)h=Math.imul(h^unit.charCodeAt(0),16777619);const size=Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1])||16;
    let w=0;for(let i=0;i<text.length;i++)w+=size*(.38+((text.charCodeAt(i)*31+h)%17)/100);return w;};
  const makeCanvas=()=>{
    const id=++canvases;
    const canvas={__canvas:id,width:0,height:0,getContext(type,attributes){
      log.push([id,'getContext',show(type),attributes===undefined?'undefined':JSON.stringify(attributes)]);
      const state={font:'10px sans-serif'};
      const proxy=new Proxy(state,{
        get(target,key){
          if(typeof key==='symbol')return undefined;
          if(key in target)return target[key];
          if(partial&&['setTransform','createImageData','reset'].includes(key))return undefined;
          if(key==='measureText')return text=>{log.push([id,'measureText',show(text)]);return {width:widthOf(String(target.font),String(text))};};
          if(key==='createLinearGradient')return (...args)=>{const gradient={__gradient:++gradients};
            if(!partial)gradient.addColorStop=(...stop)=>{log.push([`gradient#${gradient.__gradient}`,'stop',...stop.map(show)]);};
            log.push([id,key,...args.map(show),`gradient#${gradient.__gradient}`]);return gradient;};
          if(key==='createImageData')return (w,h)=>{const image={__image:++images,data:new Uint8ClampedArray(w*h*4)};log.push([id,key,show(w),show(h),`image#${image.__image}`]);return image;};
          if(key==='putImageData')return (image,x,y)=>{log.push([id,key,`image#${image.__image}`,show(x),show(y),[...image.data].join(',')]);};
          if(key==='getImageData')return (x,y,w,h)=>{const data=new Uint8ClampedArray(w*h*4);for(let i=0;i<data.length;i++)data[i]=(i*7+(i>>8))&255;log.push([id,key,show(x),show(y),show(w),show(h)]);return {data};};
          if(key==='createPattern')return ()=>null;
          if(key==='reset')return ()=>{log.push([id,'reset']);};
          return (...args)=>{log.push([id,key,...args.map(show)]);};
        },
        set(target,key,value){log.push([id,'set',key,show(value)]);target[key]=value;return true;}
      });
      return proxy;
    }};
    return canvas;
  };
  vi.stubGlobal('document',{createElement:tag=>{if(tag!=='canvas')throw new Error('Unexpected node');return makeCanvas();}});
  return log;
}
let queue;
beforeEach(()=>{queue=[];vi.stubGlobal('queueMicrotask',callback=>{queue.push(callback);});});
afterEach(()=>{vi.unstubAllGlobals();});
const release=()=>{for(const callback of queue.splice(0))callback();};

function random(seed){return ()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}
const WORDS=['Don','Quijote','La','Casa','de','los','Espíritus','Ñandú','Crónica','Muerte','Anunciada','The','Quiet','Garden','東京','物語','😀','🐉','Ω','İstanbul','\ud800','x\udc00y',''];
function sample(next,seed){
  const words=Array.from({length:Math.floor(next()*9)},()=>WORDS[Math.floor(next()*WORDS.length)]).join(next()<.2?'':' ');
  const fonts=['Playfair Display','Lora','Cormorant Garamond','DM Sans','Montserrat','Oswald',undefined];
  const book={id:next()<.1?undefined:`b${seed}-${Math.floor(next()*1e6)}`,title:next()<.08?undefined:words,author:[undefined,'Gabriel García Márquez',['A. Autor','B. Autora'],{name:'  Ana  Pérez '},'',7][Math.floor(next()*6)],
    spineEngraved:next()<.3?true:next()<.5?false:undefined,spineFinish:[undefined,'gold','silver','matte','x'][Math.floor(next()*5)],spineTextFinish:[undefined,'gold','silver','matte'][Math.floor(next()*4)],
    spineSurfaceFinish:[undefined,'matte','glossy','satin','bad'][Math.floor(next()*5)],spineTitleOverride:next()<.2?`Override ${Math.floor(next()*100)} ${words}`:undefined};
  const family=fonts[Math.floor(next()*fonts.length)];
  const style={color:['#42604b','#aa3355','#112233',undefined][Math.floor(next()*4)],ink:next()<.8?'#ffffff':undefined,width:[10,31,32,40,55][Math.floor(next()*5)],
    fontFamily:family,fontCanvasFamily:next()<.5?family:undefined,fontFallback:next()<.5?'Georgia, serif':undefined,fontWeight:[undefined,400,700,'600',0][Math.floor(next()*5)],
    spineFontSize:[undefined,6,10,13.7,48,'12'][Math.floor(next()*6)],spineAuthorFontSize:[undefined,6,12,22.4,36][Math.floor(next()*5)]};
  const options={textureWidth:[undefined,128,256,512,255.5,0,'300'][Math.floor(next()*7)],textureHeight:[undefined,512,1024,2048,1023.5,'900'][Math.floor(next()*6)],
    engraving:[undefined,true,false,0][Math.floor(next()*4)],level:[undefined,'detail','shelf','overview','other'][Math.floor(next()*5)]};
  return {book,style,options,height:[undefined,200,180.5,150][Math.floor(next()*4)],thickness:[undefined,32,20,7.5,60,45][Math.floor(next()*6)]};
}
function describe(surface){
  const probes=[];for(const u of [0,.25,.5,.999,1])for(const v of [0,.3,.77,1])probes.push(surface.relief?surface.relief(u,v):null);
  const m=surface.material;
  return {map:show(surface.map.image),channels:show(surface.channels.image),colorSpace:surface.map.colorSpace,probes,
    material:{...m,map:show(m.map.image),roughnessMap:show(m.roughnessMap.image),metalnessMap:show(m.metalnessMap.image),bumpMap:m.bumpMap&&show(m.bumpMap.image),sheenColor:m.sheenColor.getHexString()}};
}
async function run(module,input,partial){
  const log=environment({partial});
  const outcome=(()=>{try{return {value:describe(module.spineSurface(input.book,input.style,input.height,input.thickness,input.options))};}catch(error){return {error:`${error.constructor.name}: ${error.message}`};}})();
  release();
  return {log,outcome};
}

it('paints every canvas operation of 1500 random spines exactly like the original',async()=>{
  const next=random(2024);let stretched=0,engraved=0,feet=0,devices=0;
  for(let i=0;i<1500;i++){
    const input=sample(next,i),partial=i%7===0;
    const expected=await run(original,input,partial),actual=await run(production,input,partial);
    expect(actual.outcome).toEqual(expected.outcome);
    expect(actual.log.length).toBe(expected.log.length);
    for(let j=0;j<expected.log.length;j++)if(JSON.stringify(actual.log[j])!==JSON.stringify(expected.log[j]))throw new Error(`case ${i}, operation ${j}: ${JSON.stringify(actual.log[j])} / ${JSON.stringify(expected.log[j])}`);
    if(expected.log.some(entry=>entry[1]==='fillText'&&entry[2]?.endsWith('…"')))stretched++;
    if(input.book.spineEngraved===true&&input.options.engraving!==false&&input.options.engraving!==0)engraved++;
    if(expected.log.filter(entry=>entry[1]==='fillText').length===2&&expected.log.some(entry=>entry[1]==='measureText'))feet++;
    if(expected.log.some(entry=>entry[1]==='arc'))devices++;
  }
  expect(stretched).toBeGreaterThan(5);expect(engraved).toBeGreaterThan(50);expect(feet).toBeGreaterThan(50);expect(devices).toBeGreaterThan(30);
},120_000);

it('lays out and decorates spines with the same bytes as the original for random books',()=>{
  const next=random(77);
  for(let i=0;i<4000;i++){
    const {book}=sample(next,i);
    for(const value of [book,{id:book.id},{title:book.title},{}])expect(production.spineLayout(value)).toEqual(original.spineLayout(value));
    expect(Object.keys(production.spineLayout(book))).toEqual(Object.keys(original.spineLayout(book)));
  }
  for(const empty of [null,undefined])expect(production.spineLayout(empty)).toEqual(original.spineLayout(empty));
  expect(()=>production.spineLayout({get id(){throw new Error('boom');}})).toThrow('boom');
});

it('draws the three printer devices, the field and the layout reads in the original order',()=>{
  for(const kind of [0,1,2,3,undefined,'0']){
    for(const size of [24,26,0,-5,NaN,Infinity,'12']){
      let log=environment();const c=document.createElement('canvas').getContext('2d');log.length=0;
      production.drawDevice(c,kind,size);const actual=log.splice(0);
      original.drawDevice(c,kind,size);expect(actual).toEqual(log.splice(0));
    }
  }
  for(let i=0;i<300;i++){
    const options=[undefined,{},{operation:'lighter',spread:24,channel:'g',cells:[7,24]},{spread:5,cells:[4,30]},{spread:NaN},{channel:'r',cells:[3,2]}][i%6];
    const field=module=>{
      const log=environment({partial:i%5===0});const c=document.createElement('canvas').getContext('2d');log.length=0;
      let seed=i;const stream=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
      module.paintField(c,90+i,1024,stream,options);return log;
    };
    expect(field(production)).toEqual(field(original));
  }
});

it('leaves the pooled rasters and throws like the original when a canvas call fails',async()=>{
  const book={id:'x',title:'Quiet',author:'A. Writer',spineEngraved:true},style={color:'#445566',ink:'#fff',width:40};
  for(const failing of ['fillText','drawImage','getImageData','measureText','fillRect']){
    const results=[];
    for(const module of [original,production]){
      const log=environment();const make=document.createElement;
      vi.stubGlobal('document',{createElement:tag=>{const node=make(tag);const getContext=node.getContext.bind(node);node.getContext=(...args)=>{const context=getContext(...args);
        return new Proxy(context,{get:(target,key)=>key===failing?()=>{throw new RangeError('stop '+failing);}:target[key]});};return node;}});
      let error=null;try{module.spineSurface(book,style,200,32,{level:'detail',textureWidth:64,textureHeight:128});}catch(caught){error=`${caught.constructor.name}: ${caught.message}`;}
      results.push({error,log:log.length});release();
    }
    expect(results[1]).toEqual(results[0]);
  }
});
