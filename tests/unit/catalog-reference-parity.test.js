import {readFileSync} from 'node:fs'
import {afterEach,beforeAll,describe,expect,it,vi} from 'vitest'
import * as catalogueUI from '../../src/wasm/ui/inhouse_read_ui.js'
import {createPlantCatalogNative} from '../../src/js/plant-catalog-native.js'
import {createPlantCatalog} from '../../src/js/plant-catalog.js'
import {createPlantCatalogLegacy} from './helpers/reference-plant-catalog.js'
import {PLANT_CATALOG,POT_CATALOG} from '../../src/js/plant-catalog-data.js'
import {SHELF_TYPES} from '../../src/js/shelf-types.js'
import {LAMP_CATALOG} from '../../src/js/lamp-catalog-data.js'
import {LAMP_KELVINS} from '../../src/js/lamp-kelvin.js'

// Differential proof for the removed JavaScript catalogue: the frozen reference
// builds the dialog and drives every selection in JS; the shipped Rust view must
// leave byte-identical markup after the same real clicks.
vi.mock('../../src/js/plant-catalog-preview.js',()=>({createPlantCatalogPreview:vi.fn(host=>({update:vi.fn(selection=>Object.assign(host.dataset,selection)),setActive:vi.fn(),dispose:vi.fn(()=>host.replaceChildren())}))}))
vi.mock('../../src/js/shelf-catalog-preview.js',()=>({createShelfCatalogPreview:vi.fn(host=>({update:vi.fn(selection=>{host.dataset.shelfType=selection.shelfType}),setActive:vi.fn(),dispose:vi.fn(()=>host.replaceChildren())}))}))
vi.mock('../../src/js/lamp-catalog-preview.js',()=>({createLampCatalogPreview:vi.fn(host=>({update:vi.fn(selection=>{host.dataset.lampId=selection.lampId}),setActive:vi.fn(),dispose:vi.fn(()=>host.replaceChildren())}))}))
const runtime=vi.hoisted(()=>({ui:null}))
vi.mock('../../src/js/rust-ui.js',()=>({getRustUI:()=>runtime.ui,loadRustUI:()=>Promise.resolve(runtime.ui),waitForRustUI:()=>Promise.resolve(runtime.ui)}))
// The controller's add flow runs on the shared Rust task queue, which keeps a few handles of its own once started.
let baseline=0
beforeAll(async()=>{
 catalogueUI.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')})
 const warm=new catalogueUI.RustReadingProgressQueue(()=>{},()=>{},()=>{});await warm.updateProgress('warm',0,null);warm.free()
 baseline=catalogueUI.ui_live_handles()
})
afterEach(()=>{document.body.replaceChildren();expect(catalogueUI.ui_live_handles()).toBe(baseline);runtime.ui=null})
const dialog=()=>document.querySelector('.ihr-plant-catalog')
const click=selector=>{const node=dialog().querySelector(selector);if(!node)throw new Error('missing '+selector);node.click()}
const settle=async()=>{for(let i=0;i<6;i++)await Promise.resolve()}
// Attribute order is not observable (selectors, the accessibility tree and layout ignore it): compare sorted attributes.
function canonical(node){
 if(node.nodeType===3)return JSON.stringify(node.data)
 const attributes=[...node.attributes].map(attribute=>attribute.name+'='+JSON.stringify(attribute.value)).sort().join(' ')
 return '<'+node.localName+' '+attributes+'>'+[...node.childNodes].map(canonical).join('')+'</'+node.localName+'>'
}

async function script(make,options){
 const frames=[],take=label=>frames.push([label,canonical(dialog())])
 const catalog=make(options);try{
  take('built');catalog.open();take('opened')
  for(const plant of PLANT_CATALOG){click(`[data-catalog-plant="${plant.id}"]`);take('plant '+plant.id)}
  for(const pot of POT_CATALOG){click(`[data-catalog-pot="${pot.id}"]`);take('pot '+pot.id)
   for(const node of dialog().querySelectorAll('[data-catalog-color]')){node.click();take('color '+pot.id+' '+node.dataset.catalogColor)}}
  click('[data-catalog-page="shelves"]');take('shelves')
  for(const type of SHELF_TYPES){click(`[data-catalog-shelf="${type.id}"]`);take('shelf '+type.id)}
  click('[data-catalog-page="lights"]');take('lights')
  for(const lamp of LAMP_CATALOG){click(`[data-catalog-lamp="${lamp.id}"]`);take('lamp '+lamp.id)}
  for(const kelvin of LAMP_KELVINS){click(`[data-catalog-kelvin="${kelvin}"]`);take('kelvin '+kelvin)}
  click('[data-catalog-add]');take('lamp busy');await settle();take('lamp saved');catalog.open();take('reopened')
  click('[data-catalog-page="shelves"]');click('[data-catalog-shelf="baggebo"]');click('[data-catalog-add]');take('shelf busy');await settle();take('shelf saved')
  catalog.setShelfType('walnut');take('walnut restored');catalog.open();click('[data-catalog-add]');take('plant busy');await settle();take('plant saved')
  catalog.open();click('[data-catalog-add]');await settle();take('failed add');catalog.open()
 }finally{catalog.destroy()}
 return frames
}
const behaviour=()=>{
 let call=0
 return{onAdd:vi.fn(()=>++call===3?Promise.reject(new Error('private')):Promise.resolve()),onAddLamp:vi.fn(()=>Promise.resolve()),onShelfChange:vi.fn(()=>Promise.resolve()),onClose:vi.fn()}
}

describe('Rust catalogue against the frozen JavaScript reference',()=>{
 it('leaves identical markup (attribute order aside) after every selection, page, busy state and failure',async()=>{
  runtime.ui=null
  const reference=await script((options)=>createPlantCatalogLegacy(options,'ihr-plant-catalog-parity'),behaviour())
  expect(dialog()).toBeNull()
  runtime.ui=catalogueUI
  const shipped=await script((options)=>createPlantCatalogNative(options,'ihr-plant-catalog-parity',catalogueUI),behaviour())
  expect(shipped.map(([label])=>label)).toEqual(reference.map(([label])=>label))
  expect(reference.length).toBeGreaterThan(50)
  for(let index=0;index<reference.length;index++){
   const [label,expected]=reference[index],actual=shipped[index][1]
   if(actual!==expected){
    let at=0;while(at<expected.length&&expected[at]===actual[at])at++
    expect.fail(`${label}: first difference at ${at}\nreference ...${expected.slice(Math.max(0,at-120),at+160)}\nrust      ...${actual.slice(Math.max(0,at-120),at+160)}`)
   }
  }
 })
 it('numbers its dialogs and rejects a missing or incomplete module with a clear error',()=>{
  runtime.ui=null
  expect(()=>createPlantCatalog({})).toThrow('módulo Rust')
  runtime.ui={RustCatalogView:class{}}
  expect(()=>createPlantCatalog({})).toThrow('módulo Rust')
  runtime.ui=catalogueUI
  const first=createPlantCatalog({}),firstId=dialog().getAttribute('aria-labelledby');first.destroy()
  const second=createPlantCatalog({}),secondId=dialog().getAttribute('aria-labelledby');second.destroy()
  expect(firstId).toMatch(/^ihr-plant-catalog-\d+-title$/);expect(secondId).not.toBe(firstId)
 })
})
