import './helpers/rust-ui-ready.js'
import {expect,it} from 'vitest'
import {speechHold as frozen} from './helpers/reference-speech-hold.js'
import {readerUI} from '../../src/js/readers/rust-ui-required.js'

// The hold gesture of the audiobook (rust-ui reader_doors.rs `speech_hold`) against the frozen JavaScript: the event
// the window receives, its detail key for key, and what the listener's answer becomes.
const live=doc=>{const ui=readerUI();return ui.speech_hold(ui,doc)}
function record(make,doc,event,answer){
 const seen=[]
 const listener=received=>{
  seen.push({type:received.type,constructor:received.constructor.name,bubbles:received.bubbles,cancelable:received.cancelable,
   keys:Object.keys(received.detail),detail:{...received.detail},sameDoc:received.detail.doc===doc})
  if(answer!==undefined)received.detail.handled=answer
 }
 window.addEventListener('inhouse-speech-hold',listener)
 try{
  const hold=make(doc),out=[Object.keys(hold),typeof hold.canLongPress,typeof hold.onLongPress]
  for(const name of ['canLongPress','onLongPress','canLongPress']){
   try{out.push(['returned',hold[name](event)])}catch(error){out.push(['threw',error.constructor.name])}
  }
  return {out,seen}
 }finally{window.removeEventListener('inhouse-speech-hold',listener)}
}
it('dispatches the hold of a document like the original, probe first and for real',()=>{
 const docs=[document,{},null,undefined,'text',7]
 const events=[{clientX:12,clientY:-0},{clientX:'a',clientY:undefined},{},{clientX:NaN,clientY:1e300,extra:1},null,undefined,5,
  {get clientX(){throw new RangeError('x')},clientY:1},{clientX:1,get clientY(){throw new RangeError('y')}}]
 const answers=[undefined,true,false,0,'yes',null,{}]
 let compared=0
 for(const doc of docs)for(const event of events)for(const answer of answers){
  const expected=record(frozen,doc,event,answer),actual=record(live,doc,event,answer)
  expect(actual).toEqual(expected);compared++
  for(let i=0;i<expected.seen.length;i++){
   expect(Object.is(actual.seen[i].detail.x,expected.seen[i].detail.x)).toBe(true)
   expect(Object.is(actual.seen[i].detail.y,expected.seen[i].detail.y)).toBe(true)
  }
 }
 expect(compared).toBe(docs.length*events.length*answers.length)
})
it('reads the event in the original order: x, then y, and nothing is dispatched when a read fails',()=>{
 for(const make of [frozen,live]){
  const order=[];let dispatched=0
  const listener=()=>{dispatched++};window.addEventListener('inhouse-speech-hold',listener)
  const hold=make(document)
  hold.onLongPress({get clientX(){order.push('x');return 1},get clientY(){order.push('y');return 2}})
  expect(order).toEqual(['x','y']);expect(dispatched).toBe(1)
  expect(()=>hold.canLongPress({get clientX(){throw new Error('no')}})).toThrow('no');expect(dispatched).toBe(1)
  window.removeEventListener('inhouse-speech-hold',listener)
 }
})
