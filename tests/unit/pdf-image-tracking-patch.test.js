// @vitest-environment node
import {readFileSync} from 'node:fs';
import {expect,it,vi} from 'vitest';
import {patchPDFImageTracking,pdfImageTrackingPatch} from '../../scripts/pdf-image-tracking-patch.mjs';
import {patchPDFBackground} from '../../scripts/pdf-background-patch.mjs';
const upstream=readFileSync('node_modules/pdfjs-dist/legacy/build/pdf.mjs','utf8');
function harness(source,{visible=true,tracking=true,dependencies=true}={}) {
  const start=source.indexOf('  paintInlineImageXObjectGroup('),end=source.indexOf('  paintSolidColorImageMask(',start);
  const draw=vi.fn(),record=vi.fn(),bbox=vi.fn(),clipBox=[10,20,200,400];
  const Class=new Function('drawImageAtIntegerCoords',`return class {
    #beginKnockoutElement(){return false;}
    #endKnockoutElement(){}
    ${source.slice(start,end)}
  }`)(draw);
  const value=new Class();Object.assign(value,{contentVisible:visible,current:{fillAlpha:1},
    ctx:{save:vi.fn(),restore:vi.fn(),transform:vi.fn(),scale:vi.fn()},
    imagesTracker:tracking?{record}:null,
    dependencyTracker:dependencies?{clipBox,resetBBox:vi.fn(),recordBBox:bbox,recordOperation:vi.fn()}:null,
    compose:vi.fn()});
  const map=Array.from({length:32},(_,i)=>({transform:[72,0,0,40,i%4*96,Math.floor(i/4)*82],x:0,y:0,w:4,h:1}));
  value.paintInlineImageXObjectGroup(7,{bitmap:{width:4,height:1}},map);
  return {value,draw,record,bbox,map,clipBox};
}
it('reproduces the missing repeated placements in the actual upstream method',()=>{
 const h=harness(upstream);expect(h.draw).toHaveBeenCalledTimes(32);expect(h.record).not.toHaveBeenCalled();
});
it('records every painted placement with its active clip and unit image transform',()=>{
 const h=harness(patchPDFImageTracking(upstream));expect(h.draw).toHaveBeenCalledTimes(32);expect(h.record).toHaveBeenCalledTimes(32);
 for(let i=0;i<32;i++){
  expect(h.value.ctx.transform.mock.calls[i]).toEqual(h.map[i].transform);
  expect(h.record.mock.calls[i]).toEqual([h.value.ctx,1,1,h.clipBox]);
  expect(h.record.mock.invocationCallOrder[i]).toBeGreaterThan(h.bbox.mock.invocationCallOrder[i]);
  expect(h.record.mock.invocationCallOrder[i]).toBeLessThan(h.value.ctx.restore.mock.invocationCallOrder[i]);
 }
});
it('does not record or draw hidden optional content',()=>{
 const h=harness(patchPDFImageTracking(upstream),{visible:false});expect(h.draw).not.toHaveBeenCalled();expect(h.record).not.toHaveBeenCalled();
});
it('keeps rendering without image tracking and without a dependency tracker',()=>{
 for(const options of [{tracking:false},{dependencies:false}]){
  const h=harness(patchPDFImageTracking(upstream),options);expect(h.draw).toHaveBeenCalledTimes(32);expect(h.record).not.toHaveBeenCalled();
 }
});
it('composes with the existing hidden-page scheduler patch in either order',()=>{
 expect(patchPDFBackground(patchPDFImageTracking(upstream))).toBe(patchPDFImageTracking(patchPDFBackground(upstream)));
});
it('targets only the pinned compatibility renderer and rejects drift or duplicate application',()=>{
 const plugin=pdfImageTrackingPatch();expect(plugin.transform(upstream,'C:\\repo\\node_modules\\pdfjs-dist\\legacy\\build\\pdf.mjs?x').code).toBe(patchPDFImageTracking(upstream));
 for(const path of ['/src/pdf.mjs','/node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs'])expect(plugin.transform(upstream,path)).toBeNull();
 for(const source of [upstream+upstream,patchPDFImageTracking(upstream),upstream.replace('const version = "6.3.289";','const version = "6.4.0";'),upstream.replace('  paintInlineImageXObjectGroup(opIdx, imgData, map) {','  renamed(opIdx, imgData, map) {')])expect(()=>patchPDFImageTracking(source)).toThrow(/Unexpected/);
});
