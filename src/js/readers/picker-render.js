import {getRustUI} from '../rust-ui.js'
import {neuralEngine,neuralVoiceList} from './neural-runtime.js'
import {langBase,languageName,orderNeuralVoices,recommendedNeuralFor} from './voice-catalog.js'
import {DOWNLOAD_ERRORS} from './picker-policy-legacy.js'
import {LegacyPickerRender,WARNINGS} from './picker-render-legacy.js'
const legacy=LegacyPickerRender.prototype,configured=new WeakSet()
const services={engine:neuralEngine,list:neuralVoiceList,order:(list,bookLang,deviceLang)=>orderNeuralVoices(list,{bookLang,deviceLang}),language:languageName,
 url:path=>new URL(path,new URL(import.meta.env?.BASE_URL||'/',location.href)).href,base:langBase,recommend:recommendedNeuralFor,
 cancel:handle=>cancelAnimationFrame(handle),device:()=>navigator.language,messages:DOWNLOAD_ERRORS,warnings:WARNINGS}
function view(host){
 let current=host.view
 if(typeof current?.configurePicker!=='function'){
  const View=getRustUI()?.RustNeuralView
  if(typeof View?.prototype.configurePicker!=='function')return null
  // The view owns no event listeners. Reuse its existing DOM on late adoption,
  // preserving a pressed Cancel button and focus until a repaint is needed.
  const next=new View(host.host.panel)
  next.configurePicker(services);configured.add(next)
  host.view=next;current?.free?.();return next
 }
 if(!configured.has(current)){current.configurePicker(services);configured.add(current)}
 return current
}
export function renderPicker(host){const current=view(host);return current?current.renderPicker(host):legacy.render.call(host)}
export function patchPickerProgress(host,engine){const current=view(host);return current?current.patchPickerProgress(host,engine):legacy.patchProgress.call(host,engine)}
export function rowPicker(host,engine,voice){const current=view(host);return current?current.pickerRow(host,engine,voice):legacy.row.call(host,engine,voice)}
