// @vitest-environment node
import {beforeAll,it,expect,vi} from 'vitest'
import {readFileSync} from 'node:fs'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
import {plantCatalogIllustration as original} from './helpers/reference-plant-catalog-art.js'
import {nativeIllustration,plantCatalogIllustration} from '../../src/js/plant-catalog-art.js'
const runtime=vi.hoisted(()=>({ui:null}));vi.mock('../../src/js/rust-ui.js',()=>({getRustUI:()=>runtime.ui}))
const plants=['sansevieria','monstera','chamaedorea','nephrolepis','hedera','zamioculcas','succulent','cactus','unknown',undefined,null,0,{}],pots=['muskot','muskot9','akerbar','muskotblomma','gradvis','unknown',undefined,null,0,{}],cases=[]
for(const plant of plants)for(const pot of pots)for(const potOnly of [false,true])for(const compact of [false,true,1,'yes',0,null])cases.push({plant,pot,options:{potOnly,compact}})
let wasm,retained,capacity
beforeAll(()=>{wasm=ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')})})
function compare(value){expect(nativeIllustration(ui,value.plant,value.pot,value.options)).toBe(original(value.plant,value.pot,value.options))}
it('proves the diagnostic counter observes retained references',()=>{const before=ui.ui_live_handles(),control=new ui.RustReadingProgressQueue(()=>{},()=>{},()=>{});expect(ui.ui_live_handles()).toBeGreaterThan(before);control.free();expect(ui.ui_live_handles()).toBe(before)})
for(let block=0;block<13;block++)it('preserves exact SVG bodies, styles and coercion: block '+block,()=>{
 for(const value of cases.slice(block*120,(block+1)*120))compare(value)
 if(block===12){retained=ui.ui_live_handles();capacity=wasm.memory.buffer.byteLength}
})
for(let block=0;block<13;block++)it('keeps memory and handles bounded: block '+block,()=>{
 for(let cycle=0;cycle<3;cycle++)for(const value of cases.slice(block*120,(block+1)*120))compare(value)
 expect(ui.ui_live_handles()).toBe(retained);expect(wasm.memory.buffer.byteLength).toBe(capacity)
})
it('rejects nonfinite, excessive and malformed leaf packets',()=>{
 for(const sizes of [[NaN],[Infinity],[-Infinity],Array(11).fill(1)])expect(ui.catalog_frond_numbers(sizes)).toBeUndefined()
 expect(ui.catalog_illustration('nephrolepis','muskot',false,false)).toBeUndefined()
 expect(ui.catalog_frond_illustration('monstera','muskot',false,'')).toBeUndefined()
 for(const text of ['1',Array(90).fill('x').join('\0'),Array(90).fill('1e999').join('\0'),'1'.repeat(8193)])expect(ui.catalog_frond_illustration('nephrolepis','muskot',false,text)).toBeUndefined()
})
it.each([false,true])('preserves getter order and default parameters with Rust=%s',rust=>{
 runtime.ui=rust?ui:null;const seen=[],options={get potOnly(){seen.push('potOnly');return false},get compact(){seen.push('compact');return true}}
 // The frozen JS art is the oracle; a cold module has no JS twin any more and fails after reading the options in order.
 if(rust)expect(plantCatalogIllustration('nephrolepis',undefined,options)).toBe(original('nephrolepis',undefined,{potOnly:false,compact:true}));
 else expect(()=>plantCatalogIllustration('nephrolepis',undefined,options)).toThrow('módulo Rust');
 expect(seen).toEqual(['potOnly','compact']);runtime.ui=null
})
it('fails with a clear error, never with different art, for a cold or incomplete module',()=>{
 for(const candidate of [null,{}, {catalog_illustration:()=>null}]){runtime.ui=candidate;for(const value of cases.slice(0,120))expect(()=>plantCatalogIllustration(value.plant,value.pot,value.options)).toThrow('módulo Rust')}runtime.ui=null
})
it('rejects a module whose drawing is not a string instead of returning it',()=>{
 runtime.ui={...ui,catalog_illustration:()=>undefined};expect(()=>plantCatalogIllustration('monstera','muskot',{})).toThrow('no pudo dibujar');runtime.ui=null
})
