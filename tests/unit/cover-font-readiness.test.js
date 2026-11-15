import {afterEach,expect,it,vi} from 'vitest';
// The colour and the planes are prepared inside the shelf module (rust-ui/src/cover_style.rs, font_planes.rs), which no test double replaces:
// what is watched is the host around them. Until the fonts arrive only the colour has asked for the numeric
// core and the analysis is pending; once they do, it finishes with a family.
const state=vi.hoisted(()=>({core:null}));
vi.mock('../../src/js/rust-core.js',()=>({loadedRustCore:(...args)=>state.core(...args),requireRustCore:async()=>({available:true})}));
const originalFonts=Object.getOwnPropertyDescriptor(document,'fonts');
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();if(originalFonts)Object.defineProperty(document,'fonts',originalFonts);else delete document.fonts;});
it('waits for fonts before native pixel preparation',async()=>{
 state.core=vi.fn(()=>({available:true}));
 let release,settled=false;const waiting=new Promise(r=>release=r),load=vi.fn(()=>waiting);
 Object.defineProperty(document,'fonts',{configurable:true,value:{load}});
 vi.stubGlobal('Image',class{naturalWidth=96;naturalHeight=144;decode(){return Promise.resolve()}});
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({drawImage(){},getImageData(){return{data:new Uint8ClampedArray(96*144*4)}}});
 const {analyzeCoverAppearance}=await import('../../src/js/cover-appearance.js');
 const analysis=analyzeCoverAppearance('fixture','').finally(()=>{settled=true;});
 await vi.waitFor(()=>expect(load).toHaveBeenCalled());await vi.dynamicImportSettled();
 for(let i=0;i<5;i++)await new Promise(resolve=>setTimeout(resolve,0));
 expect(settled).toBe(false);expect(state.core).toHaveBeenCalledOnce();release();
 const result=await analysis;expect(result.source).toBe('cover');expect(result.fontFamily).toBeTruthy();
});
