// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { launchState, launchKey, validLaunchFrame } from '../../src/js/shelf-launch-cache.js';
const storage = (values={}) => ({ length:Object.keys(values).length, key:i => Object.keys(values)[i], getItem:key => values[key] });
const view = { innerWidth:390, innerHeight:844, devicePixelRatio:2 };
const root = { style:{getPropertyValue:() => '24px'}, dataset:{theme:'dark'} };
const book = () => ({id:'book',title:'Example',cover:new Blob(['image1'],{type:'image/jpeg'}),content:new Blob(['large original']),shelfPosition:{shelf:0,x:.3},progressFraction:.2});
const key = (books=[book()],values={},viewport=view,element=root) => launchKey(launchState(books,storage(values),viewport,element));
describe('validated local launch image',()=>{
 it('survives a fresh IDB read but hashes actual cover pixels, even at identical size',async()=>{
  expect(await key()).toBe(await key(structuredClone([book()])));
  expect(await key([{...book(),cover:new Blob(['image2'],{type:'image/jpeg'})}])).not.toBe(await key());
 });
 it('rejects any changed book pose, finish, progress, membership or order',async()=>{
  const initial=await key();
  for(const patch of [{shelfPosition:{shelf:0,x:.31}},{coverFinish:'glossy'},{progressFraction:.3},{title:'Other'}])expect(await key([{...book(),...patch}])).not.toBe(initial);
  expect(await key([])).not.toBe(initial);
  expect(await key([book(),{...book(),id:'second'}])).not.toBe(await key([{...book(),id:'second'},book()]));
 });
 it('rejects changed lights, physical poses, furniture, theme, account or viewport',async()=>{
  const initial=await key();
  for(const field of ['inhouse-read-shelf-physics-v1','inhouse-read-shelf-lamps','inhouse-read-shelf-type','inhouse-read-theme','ihr_drive_profile_v2'])expect(await key(undefined,{[field]:'changed'})).not.toBe(initial);
  expect(await key(undefined,{}, {...view,innerHeight:800})).not.toBe(initial);
  expect(await key(undefined,{}, {...view,devicePixelRatio:3})).not.toBe(initial);
  expect(await key(undefined,{},view,{...root,dataset:{theme:'light'}})).not.toBe(initial);
 });
 it('ignores unrelated preferences and the original ebook binary',async()=>{
  expect(await key(undefined,{'audio-volume':'0.5'})).toBe(await key());
  expect(await key([{...book(),content:new Blob(['other original'])}])).toBe(await key());
 });
 it('retains the same picture after cloud acknowledgements without ignoring bookmark or future fields',async()=>{
  const initial=await key();
  expect(await key([{...book(),progressDirty:false,progressUpdatedAt:123,progressStateFileId:'cloud-state',lengthDirty:false,readingHistory:[{at:12}],quotes:[]}])).toBe(initial);
  expect(await key([{...book(),locator:{fraction:.5}}])).not.toBe(initial);
  expect(await key([{...book(),futureVisualField:'changed'}])).not.toBe(initial);
 });
 it('bounds and validates images and screen rectangles',()=>{
  const frame={key:'ok',image:new Blob(['png'],{type:'image/png'}),x:0,y:80,width:390,height:760};
  expect(validLaunchFrame(frame,'ok',390,844)).toBe(true);
  for(const patch of [{key:'old'},{x:NaN},{y:-1},{height:900},{width:0},{image:null},{image:new Blob(['jpeg'],{type:'image/jpeg'})},{image:new Blob([new Uint8Array(6*1024*1024+1)],{type:'image/png'})}])expect(validLaunchFrame({...frame,...patch},'ok',390,844)).toBe(false);
 });
});
