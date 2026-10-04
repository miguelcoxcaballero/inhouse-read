import { describe,expect,it,vi } from 'vitest';
import { bookReturnSignature,bookReturnCompatibility,createBookReturnCache } from '../../src/js/bookshelf-return.js';
const book={id:'compatible-return',title:'Actual book',author:'Reader',format:'PDF',progressFraction:.2};
const style={color:'#42604b',ink:'#fff',coverRatio:1.5,width:28,texture:'linen'};
const geometry={width:304.2,height:202.8,thickness:13.827272727272724,viewportWidth:390,viewportHeight:845,centerX:197.6271818181818,centerY:354.9};
const signature=(record=book,appearance=style,dimensions=geometry,url='blob:small')=>bookReturnSignature(record,appearance,dimensions,url);
const compatible=(record=book,appearance=style,dimensions=geometry)=>bookReturnCompatibility(record,appearance,dimensions);
const request=(changes={})=>({signature:signature(book,style,geometry,'blob:HD'),compatibility:compatible(),book,style,coverUrl:'blob:HD',...changes});
const make=()=>({dispose:vi.fn(),prepareReturnAppearance:vi.fn().mockResolvedValue(true)});
const retain=(cache,view)=>cache.retain(signature(),view,compatible());

describe('explicit compatible reader return',()=>{
 it('canonicalizes only comparison dimensions and preserves strict default signatures',()=>{
  const noisy={...geometry,thickness:13.827272727272726};
  expect(signature(book,style,noisy)).not.toBe(signature());
  expect(compatible(book,style,noisy)).toBe(compatible());
  expect(geometry.thickness).toBe(13.827272727272724);
 });
 it('takes the same view with a decoded HD source and updateable automatic spine style',async()=>{
  const cache=createBookReturnCache(),view=make(),next={...style,color:'#123456',fontFamily:'DM Sans'};retain(cache,view);
  await expect(cache.takeCompatible(request({signature:signature(book,next,geometry,'blob:HD'),compatibility:compatible(book,next),style:next}))).resolves.toBe(view);
  expect(view.prepareReturnAppearance).toHaveBeenCalledExactlyOnceWith(book,next,'blob:HD');
  expect(view.dispose).not.toHaveBeenCalled();expect(cache.take(signature())).toBeNull();
 });
 it('keeps default take strict for changed cover and styles despite retaining compatibility',()=>{
  const cache=createBookReturnCache(),view=make();retain(cache,view);
  expect(cache.take(signature(book,style,geometry,'blob:HD'))).toBeNull();
  expect(view.prepareReturnAppearance).not.toHaveBeenCalled();expect(view.dispose).toHaveBeenCalledOnce();
 });
 it.each(['width','height','thickness','centerX','centerY','viewportWidth','viewportHeight'])('rejects meaningful %s change before mutating the old view',async key=>{
  const cache=createBookReturnCache(),view=make(),dimensions={...geometry,[key]:geometry[key]+.01};retain(cache,view);
  await expect(cache.takeCompatible(request({signature:signature(book,style,dimensions),compatibility:compatible(book,style,dimensions)}))).resolves.toBeNull();
  expect(view.prepareReturnAppearance).not.toHaveBeenCalled();expect(view.dispose).toHaveBeenCalledOnce();
 });
 it.each([{record:{...book,title:'Changed'}},{appearance:{...style,coverRatio:1.4}},{appearance:{...style,texture:'leather'}},{appearance:{...style,newStructuralField:'unsupported'}}])('rejects changed case, ratio and unsupported structural style',async ({record=book,appearance=style})=>{
  const cache=createBookReturnCache(),view=make();retain(cache,view);
  await expect(cache.takeCompatible(request({signature:signature(record,appearance),compatibility:compatible(record,appearance),book:record,style:appearance}))).resolves.toBeNull();
  expect(view.prepareReturnAppearance).not.toHaveBeenCalled();expect(view.dispose).toHaveBeenCalledOnce();
 });
 it.each([false,'rejection'])('disposes an unpresented upgrade failure once and leaves fallback ownership clear',async result=>{
  const cache=createBookReturnCache(),view=make();retain(cache,view);
  if(result==='rejection')view.prepareReturnAppearance.mockRejectedValue(new Error('decode failed'));else view.prepareReturnAppearance.mockResolvedValue(false);
  await expect(cache.takeCompatible(request())).resolves.toBeNull();cache.clear();expect(view.dispose).toHaveBeenCalledOnce();
 });
 it('releases pending compatible ownership on destroy and ignores its later completion',async()=>{
  const cache=createBookReturnCache(),view=make();let finish;view.prepareReturnAppearance.mockReturnValue(new Promise(resolve=>finish=resolve));retain(cache,view);
  const pending=cache.takeCompatible(request());cache.clear();expect(view.dispose).toHaveBeenCalledOnce();finish(true);
  await expect(pending).resolves.toBeNull();cache.clear();expect(view.dispose).toHaveBeenCalledOnce();
 });
 it('uses the unchanged fast strict path without demanding the optional update method',async()=>{
  const cache=createBookReturnCache(),view={dispose:vi.fn()};retain(cache,view);
  await expect(cache.takeCompatible(request({signature:signature()}))).resolves.toBe(view);expect(view.dispose).not.toHaveBeenCalled();
 });
});
