import {readFileSync} from 'node:fs'
import {afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest'
import * as catalogueUI from '../../src/wasm/ui/inhouse_read_ui.js'
import {createPlantCatalogNative} from '../../src/js/plant-catalog-native.js'
import {createPlantCatalogLegacy} from './helpers/reference-plant-catalog.js'

// The camera flight, the closing order and the studio hand-offs of the Rust controller, event for event,
// against the frozen JavaScript catalogue. Both run on the same stubbed Web Animations and timers.
const studios=vi.hoisted(()=>({log:null,ui:null}))
const trace=(name,...rest)=>studios.log?.push([name,...rest].join(' '))
vi.mock('../../src/js/plant-catalog-preview.js',()=>({createPlantCatalogPreview:vi.fn(host=>({update:selection=>trace('plant.update',JSON.stringify(selection)),setActive:value=>trace('plant.active',value),dispose:()=>trace('plant.dispose'),prepare:()=>trace('plant.prepare')}))}))
vi.mock('../../src/js/shelf-catalog-preview.js',()=>({createShelfCatalogPreview:vi.fn(host=>({update:selection=>trace('shelf.update',JSON.stringify(selection)),setActive:value=>trace('shelf.active',value),dispose:()=>trace('shelf.dispose')}))}))
vi.mock('../../src/js/lamp-catalog-preview.js',()=>({createLampCatalogPreview:vi.fn(host=>({update:selection=>trace('lamp.update',JSON.stringify(selection)),setActive:value=>trace('lamp.active',value),dispose:()=>trace('lamp.dispose')}))}))
vi.mock('../../src/js/rust-ui.js',()=>({getRustUI:()=>studios.ui}))
let baseline=0
beforeAll(async()=>{
 catalogueUI.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')})
 const warm=new catalogueUI.RustReadingProgressQueue(()=>{},()=>{},()=>{});await warm.updateProgress('warm',0,null);warm.free()
 baseline=catalogueUI.ui_live_handles()
})
const rect=(left,top,width,height)=>({left,top,width,height,right:left+width,bottom:top+height,x:left,y:top,toJSON(){return this}})
let animations,originals
beforeEach(()=>{
 vi.useFakeTimers()
 animations=[]
 originals={animate:Element.prototype.animate,rect:Element.prototype.getBoundingClientRect,matchMedia:globalThis.matchMedia,raf:globalThis.requestAnimationFrame}
 Element.prototype.animate=function(frames,timing){
  const animation={target:this.className||this.tagName,frames,timing,playState:'running',cancelled:false,finish:null}
  animation.finished=new Promise((resolve,reject)=>{animation.finish=()=>{animation.playState='finished';resolve(animation)};animation.fail=reject})
  animation.cancel=()=>{animation.cancelled=true;animation.playState='idle';trace('cancel',animation.target)}
  animations.push(animation);trace('animate',animation.target,JSON.stringify(frames.map(frame=>frame.transform??null)),timing.duration);return animation
 }
 Element.prototype.getBoundingClientRect=function(){
  if(this.classList?.contains('booklet'))return rect(20,600,80,100)
  if(this.classList?.contains('ihr-plant-catalog'))return rect(0,0,390,700)
  if(this.classList?.contains('stage'))return rect(0,0,390,844)
  if(this.classList?.contains('ihr-plant-catalog__paper'))return rect(10,10,370,680)
  return rect(0,0,0,0)
 }
 globalThis.matchMedia=()=>({matches:false})
 globalThis.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),16)
})
afterEach(()=>{
 Element.prototype.animate=originals.animate;Element.prototype.getBoundingClientRect=originals.rect;globalThis.matchMedia=originals.matchMedia;globalThis.requestAnimationFrame=originals.raf
 vi.useRealTimers();document.body.replaceChildren();expect(catalogueUI.ui_live_handles()).toBe(baseline)
})
// A flight is two animations (the room, then the page); landing waits for the room's.
const finishFlight=()=>{for(const animation of animations.slice(-2))animation.finish()}
const tick=async()=>{for(let i=0;i<12;i++)await Promise.resolve()}
const dialog=()=>document.querySelector('.ihr-plant-catalog')
const snapshot=()=>!dialog()?'dialog removed':`${dialog().hasAttribute('open')} cam=${dialog().dataset.catalogCamera??'-'} inert=${dialog().querySelector('.ihr-plant-catalog__paper').inert} origin=${document.querySelector('.stage').style.transformOrigin||'-'} page=${dialog().dataset.catalogPage}`

async function scenario(make){
 const events=[];studios.log=events
 const trigger=document.createElement('button');trigger.className='booklet';document.body.append(trigger)
 const stage=document.createElement('div');stage.className='stage';document.body.append(stage)
 let saves=0
 const options={
  onAdd:()=>{events.push('onAdd');return Promise.resolve()},onAddLamp:()=>Promise.resolve(),
  onShelfChange:(selection,{whenClosed})=>{events.push('onShelfChange '+JSON.stringify(selection));whenClosed(()=>events.push('work: shelf redraw '+(++saves)));whenClosed(()=>{throw new Error('boom')});return Promise.resolve()},
  onClose:()=>events.push('onClose'),motionTarget:()=>stage,onMotion:phase=>events.push('motion '+phase)
 }
 const warn=vi.spyOn(console,'warn').mockImplementation((...args)=>events.push('warn '+String(args[0])))
 const catalog=make(options);const step=async label=>{await tick();events.push(`${label}: ${snapshot()}`)}
 try{
  // Opening flight, landing by itself.
  catalog.open(trigger);await step('opened')
  finishFlight();await vi.advanceTimersByTimeAsync(1);await step('landed')
  // Close while open: a closing flight, interrupted by a second request (ignored) and then landed.
  catalog.close();await step('closing')
  catalog.close();await step('closing again')
  finishFlight();await vi.advanceTimersByTimeAsync(40);await step('closed')
  await vi.advanceTimersByTimeAsync(100);await step('closed later')
  // Reopen, leave mid-flight: the opening flight lands, then the page closes with a flight of its own.
  catalog.open(trigger);await step('reopened')
  catalog.close();await step('closing mid-opening')
  catalog.close({instant:true});await step('instant close')
  await vi.advanceTimersByTimeAsync(100);await step('instant closed')
  // A shelf change registers shelf work that runs after the closing flight has painted.
  catalog.open(trigger);finishFlight();await vi.advanceTimersByTimeAsync(1);await step('open for shelf')
  dialog().querySelector('[data-catalog-page="shelves"]').click();await step('shelves')
  dialog().querySelector('[data-catalog-shelf="baggebo"]').click();dialog().querySelector('[data-catalog-add]').click();await step('shelf add')
  await vi.advanceTimersByTimeAsync(1);finishFlight();await vi.advanceTimersByTimeAsync(400);await step('shelf closed')
  await vi.advanceTimersByTimeAsync(100);await step('shelf work done')
  // The safety timer lands a flight whose animation never reports; a hidden tab lands at once.
  catalog.open(trigger);await step('open for guard');animations.at(-2).playState='idle';await vi.advanceTimersByTimeAsync(2000);await step('guard landed')
  catalog.close();await step('closing for guard');animations.at(-2).playState='idle';await vi.advanceTimersByTimeAsync(2000);await step('guard closed')
  // Destroying mid-flight puts the room back and releases every studio once.
  catalog.open(trigger);finishFlight();await vi.advanceTimersByTimeAsync(1)
  catalog.close();await step('closing before destroy')
  catalog.destroy();await step('destroyed')
  catalog.destroy();catalog.open(trigger);await step('after destroy')
  // Whatever paint callbacks are still pending belong to this run, not to the next one.
  await vi.runAllTimersAsync();await step('flushed')
 }finally{warn.mockRestore();trigger.remove();stage.remove()}
 return events
}

describe('catalogue flight against the frozen reference',()=>{
 it('orders animations, landings, callbacks, studios and shelf work identically',async()=>{
  studios.ui=null
  const reference=await scenario(options=>createPlantCatalogLegacy(options,'ihr-plant-catalog-flight'))
  document.body.replaceChildren();animations.length=0;studios.ui=catalogueUI
  const shipped=await scenario(options=>createPlantCatalogNative(options,'ihr-plant-catalog-flight',catalogueUI))
  expect(reference.filter(line=>line.startsWith('animate')).length).toBeGreaterThanOrEqual(8)
  expect(reference.some(line=>line.startsWith('work: shelf redraw'))).toBe(true)
  expect(reference.some(line=>line.startsWith('warn'))).toBe(true)
  expect(shipped).toEqual(reference)
 })
})

// Host callbacks that throw or reject: the status text, the busy state and what still runs afterwards.
async function failures(make){
 const events=[];studios.log=events
 let mode='sync',closeFails=false
 const options={
  onAdd:()=>{events.push('onAdd '+mode);if(mode==='sync')throw new Error('private details');return mode==='reject'?Promise.reject(new Error('private details')):Promise.resolve()},
  onClose:()=>{events.push('onClose');if(closeFails)throw new Error('close failed')}
 }
 const catalog=make(options),trigger=document.createElement('button');document.body.append(trigger);trigger.focus()
 const status=()=>`${dialog().hasAttribute('open')} busy=${dialog().getAttribute('aria-busy')} add=${dialog().querySelector('[data-catalog-add]').disabled} text=${JSON.stringify(dialog().querySelector('[role=status]').textContent)} error=${dialog().querySelector('[role=status]').dataset.error??'-'} focus=${document.activeElement===trigger}`
 try{
  catalog.open(trigger);await tick();events.push('open '+status())
  dialog().querySelector('[data-catalog-add]').click();await tick();events.push('sync throw '+status())
  mode='reject';dialog().querySelector('[data-catalog-add]').click();events.push('rejecting '+status());await tick();events.push('rejected '+status())
  mode='close-fails';closeFails=true;dialog().querySelector('[data-catalog-add]').click();await tick();events.push('close throws '+status())
  closeFails=false;catalog.close();await tick();events.push('closed '+status())
  catalog.open(trigger);mode='ok';dialog().querySelector('[data-catalog-add]').click();events.push('saving '+status());catalog.destroy();await tick();events.push('destroyed while saving '+String(dialog()))
 }finally{trigger.remove()}
 return events
}
describe('catalogue failures against the frozen reference',()=>{
 it('reports a throwing or rejecting host the same way',async()=>{
  studios.ui=null
  const reference=await failures(options=>createPlantCatalogLegacy(options,'ihr-plant-catalog-failures'))
  document.body.replaceChildren();studios.ui=catalogueUI
  const shipped=await failures(options=>createPlantCatalogNative(options,'ihr-plant-catalog-failures',catalogueUI))
  expect(reference.some(line=>line.includes('No se pudo añadir. Reintenta.'))).toBe(true)
  expect(shipped).toEqual(reference)
 })
})
