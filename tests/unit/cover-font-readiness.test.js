import {afterEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({ready:false,prepare:vi.fn((core,raw,w,h)=>core?{gray:new Uint8Array(w*h),near:null,busy:false}:null)}));
vi.mock('../../src/js/rust-core.js',()=>({loadedRustCore:()=>({available:true}),requireRustCore:async()=>({available:true})}));
vi.mock('../../src/js/cover-color-wasm.js',()=>({rustCoverColor:()=>({color:'#5a4130',shade:'#443125',ink:'#fffaf0'})}));
vi.mock('../../src/js/font-glyph-wasm.js',()=>({rustPrepareCoverPixels:state.prepare,rustGlyphMask:()=>undefined}));
const originalFonts=Object.getOwnPropertyDescriptor(document,'fonts');
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();if(originalFonts)Object.defineProperty(document,'fonts',originalFonts);else delete document.fonts;});
it('waits for fonts before native pixel preparation',async()=>{
 let release;const waiting=new Promise(r=>release=r),load=vi.fn(()=>waiting);
 Object.defineProperty(document,'fonts',{configurable:true,value:{load}});
 vi.stubGlobal('Image',class{naturalWidth=96;naturalHeight=144;decode(){return Promise.resolve()}});
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({drawImage(){},getImageData(){return{data:new Uint8ClampedArray(96*144*4)}}});
 const {analyzeCoverAppearance}=await import('../../src/js/cover-appearance.js');
 const analysis=analyzeCoverAppearance('fixture','');
 await vi.waitFor(()=>expect(load).toHaveBeenCalled());await vi.dynamicImportSettled();
 expect(state.prepare).not.toHaveBeenCalled();state.ready=true;release();
 const result=await analysis;expect(result.source).toBe('cover');expect(state.prepare).toHaveBeenCalledOnce();expect(state.prepare.mock.calls[0][0]).toEqual({available:true});
});
