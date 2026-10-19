// @vitest-environment node
import {expect,it} from 'vitest';
import {rustShelf} from './helpers/rust-shelf-ready.js';
import {normalizeCoverRelief,coverReliefLayers,fitDimensions,buildMapsFromPixels,drain} from '../../src/js/cover-relief.js';
import * as old from './helpers/reference-relief-policy.js';
const result=fn=>{try{return{value:fn()}}catch(error){return{error:{name:error.name,message:error.message}}}};
const compare=(value)=>{expect(result(()=>normalizeCoverRelief(value))).toEqual(result(()=>old.normalizeCoverRelief(value)));expect(result(()=>coverReliefLayers(value))).toEqual(result(()=>old.coverReliefLayers(value)));};
const colour=(index=1)=>({id:'color-'+index,color:'#AbC123',tolerance:6,strength:.755});
it('retains portable single-layer values, coercion, rounding and malformed input behavior',()=>{
 const values=[undefined,null,false,true,0,1,'color-1',[],()=>{},new String('color-1'),{},...old.RELIEF_IDS.map(id=>({...colour(),id})),...['color-0','color-01','color-11','Color-1'].map(id=>({...colour(),id}))];
 for(const strength of [undefined,null,false,true,'','0.755','garbage',-.01,-0,0,.005,.015,.755,1,2,NaN,Infinity,-Infinity,[],[.333],{},Object(.25),1n,Symbol('x')])values.push({...colour(),strength});
 for(const tolerance of [undefined,null,false,true,'6',new Number(6),NaN,Infinity,-1,0,.999,1,1.005,6.555,12,12.001,Symbol('x')])values.push({...colour(),tolerance});
 for(const color of [undefined,null,123,new String('#abcdef'),'#abcdef','#ABCDEF','#abc','#abcdef00','abcdef','#abcdeg','#abcdef\n','＃abcdef',' #abcdef'])values.push({...colour(),color});
 for(const value of values)compare(value);
});
it('preserves first-ten slicing, duplicate colors, nested exclusions, sparse arrays and input immutability',()=>{
 const input={layers:[colour(1),{...colour(2),color:'#abc123'},null,{},false,{id:'foil'},{layers:[colour()]},{...colour(4),color:'#321cba'},...Array.from({length:9},(_,i)=>({...colour(),color:'#'+(i+200).toString(16).padStart(6,'0')}))],ignored:true};
 const snapshot=structuredClone(input);compare(input);expect(input).toEqual(snapshot);
 compare({layers:new Array(10)});compare({layers:Object.assign(new Array(11),{2:colour(),10:{...colour(),color:'#010203'}})});
 compare({layers:[]});compare({...colour(),layers:[]});compare({...colour(),layers:{length:1,0:colour()}});
 const a=normalizeCoverRelief(input),b=normalizeCoverRelief(input);expect(a).not.toBe(b);expect(a.layers[0]).not.toBe(b.layers[0]);
});
it('retains getter order, conversion exceptions and error identity',()=>{
 for(const key of ['layers','id','strength','color','tolerance']){
  const boom=new Error('getter '+key),make=()=>Object.defineProperty(colour(),key,{get(){throw boom}});
  expect(result(()=>normalizeCoverRelief(make()))).toEqual(result(()=>old.normalizeCoverRelief(make())));
  try{normalizeCoverRelief(make())}catch(error){expect(error).toBe(boom)}
 }
 const observe=implementation=>{const calls=[];const input=new Proxy(colour(),{get(target,key){calls.push(key);return target[key]}});return{value:implementation(input),calls}};
 expect(observe(normalizeCoverRelief)).toEqual(observe(old.normalizeCoverRelief));
 const make=()=>({...colour(),strength:{valueOf(){throw new RangeError('conversion')}}});
 expect(result(()=>normalizeCoverRelief(make()))).toEqual(result(()=>old.normalizeCoverRelief(make())));
});
it('matches thousands of portable selections without retaining host handles',()=>{
 const before=rustShelf.shelf_live_handles();let seed=781;
 for(let i=0;i<3000;i++){
  seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  const input={layers:Array.from({length:seed%13},(_,n)=>({id:'color-'+(1+n%10),color:'#'+((seed+n*97)&0xffffff).toString(16).padStart(6,'0'),tolerance:(seed%1300)/100,strength:(seed%1500)/1000-.1}))};compare(input);
 }
 expect(rustShelf.shelf_live_handles()).toBe(before);
});
it('keeps canonical layer order and rejects changed classification with the original error',()=>{
 const selection={layers:[{...colour(1),color:'#ff0000'},{...colour(2),color:'#000011'},colour(3)]};
 const expected=old.coverReliefLayers(selection).sort((a,b)=>a.color.localeCompare(b.color));
 expect(rustShelf.relief_sorted_layers(selection)).toEqual(expected);
 const maps={owners:new Uint8Array(3),layers:expected};
 expect(rustShelf.relief_selected_layers(maps,selection)).toEqual(expected);
 for(const bad of [{...maps,owners:null},{...maps,layers:[]},{...maps,layers:[...expected].reverse()},{...maps,layers:expected.map(x=>({...x,tolerance:3}))}])expect(()=>rustShelf.relief_selected_layers(bad,selection)).toThrow('Las zonas de relieve han cambiado');
});
it('preserves dimensions including nonfinite values, coercion and repeated primitive conversions',()=>{
 for(const width of [0,1,17,192,512,Infinity,-Infinity,NaN,-0,-17,'192',null,undefined,1n])for(const height of [0,1,288,Infinity,NaN])for(const long of [0,64,288,512,Infinity,NaN,'96',1n])expect(result(()=>fitDimensions(width,height,long))).toEqual(result(()=>old.fitDimensions(width,height,long)));
 const observe=implementation=>{const calls=[],dimension=name=>({valueOf(){calls.push(name);return name==='w'?360:540}});return{value:implementation(dimension('w'),dimension('h'),288),calls}};
 expect(observe(fitDimensions)).toEqual(observe(old.fitDimensions));
});
it('keeps quantile ordering, undefined slots, NaN ties, boundary indexes and conversion errors',()=>{
 for(const values of [[],[4],[3,1,2],[NaN,1,0,2],[0,NaN,2,1],[-0,0,Infinity,-Infinity],new Array(4),[4,undefined,1],new Float64Array([4,1,3,2]),'321',[1n,2n],[1,2n]])for(const fraction of [-Infinity,-1,-0,.5,.95,1,Infinity,NaN,'0.5',null,1n,Symbol('x')])expect(result(()=>rustShelf.relief_quantile(values,fraction))).toEqual(result(()=>old.quantile(values,fraction)));
 const before=rustShelf.shelf_live_handles();for(let i=0;i<1000;i++)rustShelf.relief_quantile([3,1,2,NaN,undefined],.5);expect(rustShelf.shelf_live_handles()).toBe(before);
});
it('preserves raster validation and public pixel-generator errors',()=>{
 const valid={width:2,height:3,data:new Uint8Array(24)};
 for(const image of [null,undefined,false,{},valid,{...valid,width:0},{...valid,width:'2'},{...valid,height:1.5},{...valid,data:new Uint8Array(23)},{...valid,data:{length:24}},{...valid,data:{length:'24'}}]){
  expect(result(()=>rustShelf.relief_validate_raster(image))).toEqual(result(()=>old.validateRaster(image)));
  if(result(()=>old.validateRaster(image)).error)expect(()=>drain(buildMapsFromPixels(image,image,colour()))).toThrow('Portada sin píxeles RGBA válidos');
 }
});
it('keeps proposal metadata, shared analysis arrays and exact report rounding',()=>{
 const mask=new Float32Array([1,.5,0]),found={seed:173,opaque:3,colours:[{rgb:[171,193,35],tolerance:3.75,pixels:2,mask}]};
 const actual=rustShelf.relief_analysis_result(found),chosen=[{id:'color-1',color:'#abc123',tolerance:3.75,strength:.75,detected:true,confidence:1,recipe:{kind:'color',color:'#abc123',tolerance:3.75},mask,facts:{color:'#abc123',coverage:2/3,pixels:2}}];
 expect(actual).toEqual({chosen,candidates:chosen,seed:173,feats:{photo:false,busy:0,strokeFraction:0},colorSpace:'oklab-100',opaquePixels:3});
 expect(actual.chosen).toBe(actual.candidates);expect(actual.chosen[0].mask).toBe(mask);
 const described=rustShelf.relief_describe(chosen[0]);
 expect(rustShelf.relief_proposal(chosen[0],'data:image/test')).toEqual({id:'color-1',color:'#abc123',tolerance:3.75,...described,strength:.75,thumbnail:'data:image/test',confidence:1,detected:true});
 for(const durations of [[],[.015,7.35,1.4,2.3],[0,0,.05,.15,.25,1.234]]){
  const stats={ms:13.5,slices:durations.length,longestSliceMs:7.35,durations},work={width:64,height:96};
  expect(rustShelf.relief_analysis_report(actual,work,stats)).toEqual({...work,seed:173,colorSpace:'oklab-100',photo:false,busy:0,strokeFraction:0,candidates:[{id:'color-1',confidence:1,facts:chosen[0].facts}],ms:14,slices:durations.length,longestSliceMs:Math.round(7.35*10)/10,medianSliceMs:Math.round(old.quantile(durations,.5)*10)/10,p95SliceMs:Math.round(old.quantile(durations,.95)*10)/10});
 }
});
it('keeps native map planning, classification profiles and rendering coefficients exact',()=>{
 for(const selection of [{id:'foil'},colour(),{layers:[colour()]}]){
  const choice=old.normalizeCoverRelief(selection),mode=choice.layers?2:old.COLOR_RELIEF_IDS.includes(choice.id)?1:0;
  expect(rustShelf.relief_map_mode(choice)).toBe(mode);
 }
 const layers=Array.from({length:10},(_,i)=>({...colour(i+1),color:'#'+(i*1677761).toString(16).padStart(6,'0')}));
 expect(rustShelf.relief_classification_layers(layers)).toEqual(layers.map(layer=>({color:layer.color,tolerance:layer.tolerance,heightMM:rustShelf.color_relief_profile(layer).heightMM})));
 for(const value of [undefined,null,false,true,0,-0,-1,64,65.5,288,512,1000,NaN,Infinity,'128',{},1n,Symbol('size')]){
  expect(result(()=>rustShelf.relief_map_resolution(value))).toEqual(result(()=>Math.min(512,Math.max(64,value))));
  expect(result(()=>rustShelf.relief_shade_scale(value))).toEqual(result(()=>value*.6/255*14));
 }
 for(const width of [0,-0,1,96,288,512,Infinity,NaN,'288',null,1n])for(const height of [0,1,192,512,NaN]){
  for(const gain of [0,1,7,.3,Infinity,NaN,'2',1n])expect(result(()=>rustShelf.relief_normal_unit(width,height,gain))).toEqual(result(()=>.6/255/(2*(200/Math.max(width,height)))*gain));
  expect(result(()=>rustShelf.relief_thumbnail_size(width,height))).toEqual(result(()=>{const scale=Math.min(1,132/width);return{width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))}}));
 }
});
it('retains custom slice iterator semantics for portable records',()=>{
 for(const iterator of ['abc',new Set([colour()]),[colour()],[]]){
  const layers=[colour()];layers.slice=()=>iterator;compare({layers});
 }
});
