import {it,expect,beforeAll,afterEach} from 'vitest'
import {readFileSync} from 'node:fs'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
import {speechHold as reference} from './helpers/reference-speech-hold.js'

// The hold handlers of the readers' gesture tables are Rust (rust-ui speech_hold.rs). They must
// dispatch the same event with the same detail, in the same key order, and answer what a listener
// left in `detail.handled`, exactly as the frozen JavaScript original does.
beforeAll(()=>{ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')})})
let listener
afterEach(()=>{if(listener)window.removeEventListener('inhouse-speech-hold',listener);listener=null})

function record(make,events,answer){
 const seen=[]
 listener=event=>{
  const detail=event.detail
  seen.push({type:event.type,constructor:event.constructor.name,bubbles:event.bubbles,cancelable:event.cancelable,keys:Object.keys(detail),
   doc:detail.doc,x:detail.x,y:detail.y,probe:detail.probe,handled:detail.handled})
  const next=answer(seen.length-1,detail);if(next!==undefined)detail.handled=next
 }
 window.addEventListener('inhouse-speech-hold',listener)
 const hold=make(),results=[]
 for(const [name,event] of events){
  try{results.push(['value',hold[name](event)])}catch(error){results.push(['throw',error?.constructor?.name,String(error?.message)])}
 }
 window.removeEventListener('inhouse-speech-hold',listener);listener=null
 return {keys:Object.keys(hold),kinds:Object.values(hold).map(value=>typeof value),seen,results}
}

it('dispatches the same hold events as the original for scripted presses',()=>{
 const doc=document.implementation.createHTMLDocument('book'),other={marker:1}
 const answers=[undefined,true,false,0,1,'yes','',null,{kept:true}]
 let checks=0
 for(let trial=0;trial<300;trial++){
  const target=trial%3?doc:trial%2?other:undefined
  const events=Array.from({length:1+trial%5},(_,i)=>{
   const kind=(trial+i)%7
   const event=kind===0?{clientX:-0,clientY:NaN}:kind===1?{clientX:'12',clientY:null}:kind===2?{}:kind===3?new MouseEvent('pointerdown',{clientX:trial,clientY:i})
    :{clientX:trial*1.5+i,clientY:trial/7,extra:true}
   return [(trial+i)%2?'canLongPress':'onLongPress',event]
  })
  const answer=index=>answers[(trial+index)%answers.length]
  const expected=record(()=>reference(target),events,answer),actual=record(()=>ui.speech_hold(ui,target),events,answer)
  expect(actual.keys).toEqual(expected.keys);expect(actual.kinds).toEqual(expected.kinds)
  expect(actual.seen.length).toBe(expected.seen.length)
  for(let i=0;i<expected.seen.length;i++){
   const a=actual.seen[i],e=expected.seen[i]
   for(const key of Object.keys(e))if(key==='keys')expect(a.keys).toEqual(e.keys);else expect(Object.is(a[key],e[key]),key).toBe(true)
  }
  expect(actual.results.length).toBe(expected.results.length)
  for(let i=0;i<expected.results.length;i++){
   expect(actual.results[i][0]).toBe(expected.results[i][0])
   expect(Object.is(actual.results[i][1],expected.results[i][1])).toBe(true)
   if(expected.results[i][0]==='throw')expect(actual.results[i][2]).toBe(expected.results[i][2])
  }
  checks+=expected.seen.length
 }
 expect(checks).toBeGreaterThan(600)
})

it('fails like the original when the press has no event, and still dispatches nothing',()=>{
 for(const event of [undefined,null]){
  const outcomes=[]
  for(const make of [()=>reference(document),()=>ui.speech_hold(ui,document)]){
   let dispatched=0;const count=()=>{dispatched++};window.addEventListener('inhouse-speech-hold',count)
   let failure;try{make().canLongPress(event)}catch(error){failure=error}
   window.removeEventListener('inhouse-speech-hold',count)
   outcomes.push({name:failure?.constructor?.name,dispatched})
  }
  expect(outcomes[1]).toEqual(outcomes[0]);expect(outcomes[0].name).toBe('TypeError')
 }
})

it('keeps no Rust callback alive for the handlers it hands out',()=>{
 const before=ui.ui_live_handles?.()
 for(let i=0;i<2000;i++)ui.speech_hold(ui,document)
 if(before!==undefined)expect(ui.ui_live_handles()).toBe(before)
})
