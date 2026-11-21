// @vitest-environment node
import {beforeAll,it,expect} from 'vitest'
import {readFileSync} from 'node:fs'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
import {rustShelf} from './helpers/rust-shelf-ready.js'
// Frozen JS originals: the catalogue art (removed from src in 1.7.237) and the lamp drawings (src/js/lamp-illustration.js,
// removed when rust-ui/src/lamp_art.rs took them). src/js/plant-catalog-art.js, the host step that supplied the fern
// leaf heights from the browser's Math, is gone too: rust-ui/src/catalog_art.rs keeps those heights bit for bit.
import {plantCatalogIllustration as original} from './helpers/reference-plant-catalog-art.js'
import {lampCatalogIllustration as originalLamp} from './helpers/reference-lamp-illustration.js'
const plants=['sansevieria','monstera','chamaedorea','nephrolepis','hedera','zamioculcas','succulent','cactus','unknown',undefined,null,0,{}],pots=['muskot','muskot9','akerbar','muskotblomma','gradvis','unknown',undefined,null,0,{}],cases=[]
for(const plant of plants)for(const pot of pots)for(const potOnly of [false,true])for(const compact of [false,true,1,'yes',0,null])cases.push({plant,pot,options:{potOnly,compact}})
// The arguments the catalogue (rust-ui/src/catalog_present.rs) passes: an absent pot is the default one.
const native=({plant,pot,options})=>ui.catalog_plant_illustration(plant,pot===undefined?'muskot':pot,Boolean(options.potOnly),Boolean(options.compact))
let wasm,retained,capacity
beforeAll(()=>{wasm=ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')})})
function compare(value){expect(native(value)).toBe(original(value.plant,value.pot,value.options))}
it('proves the diagnostic counter observes retained references',()=>{const before=ui.ui_live_handles(),control=new ui.RustReadingProgressQueue(()=>{},()=>{},()=>{});expect(ui.ui_live_handles()).toBeGreaterThan(before);control.free();expect(ui.ui_live_handles()).toBe(before)})
for(let block=0;block<13;block++)it('preserves exact SVG bodies, styles and coercion: block '+block,()=>{
 for(const value of cases.slice(block*120,(block+1)*120))compare(value)
 if(block===12){retained=ui.ui_live_handles();capacity=wasm.memory.buffer.byteLength}
})
for(let block=0;block<13;block++)it('keeps memory and handles bounded: block '+block,()=>{
 for(let cycle=0;cycle<3;cycle++)for(const value of cases.slice(block*120,(block+1)*120))compare(value)
 expect(ui.ui_live_handles()).toBe(retained);expect(wasm.memory.buffer.byteLength).toBe(capacity)
})
it('draws every fern frond with the leaf heights of the browser Math it replaced',()=>{
 // The heights the deleted host step computed, recomputed here with this engine's Math (V8, like Chrome and the WebView).
 for(const plant of ['chamaedorea','nephrolepis'])for(const compact of [false,true])for(const pot of ['muskot','akerbar','muskotblomma','gradvis'])
  expect(ui.catalog_plant_illustration(plant,pot,false,compact)).toBe(original(plant,pot,{compact}))
 expect(ui.catalog_illustration('nephrolepis','muskot',false,false)).toBeUndefined()
})
const lampIds=['mittled','tarnaby','fado','lampan','unknown','',undefined,null,0,1,{},['mittled'],new String('mittled'),Symbol.iterator]
it('draws the catalogue lamps exactly like the JavaScript original in both modules',()=>{
 for(const id of lampIds){
  expect(ui.lamp_catalog_illustration(id)).toBe(originalLamp(id))
  expect(rustShelf.lamp_catalog_illustration(id)).toBe(originalLamp(id))
 }
})
