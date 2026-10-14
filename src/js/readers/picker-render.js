import {neuralEngine,neuralVoiceList} from './neural-runtime.js'
import {langBase,languageName,orderNeuralVoices,recommendedNeuralFor} from './voice-catalog.js'
import {DOWNLOAD_ERRORS,WARNINGS} from './picker-messages.js'
const configured=new WeakSet()
const services={engine:neuralEngine,list:neuralVoiceList,order:(list,bookLang,deviceLang)=>orderNeuralVoices(list,{bookLang,deviceLang}),language:languageName,
 url:path=>new URL(path,new URL(import.meta.env?.BASE_URL||'/',location.href)).href,base:langBase,recommend:recommendedNeuralFor,
 cancel:handle=>cancelAnimationFrame(handle),device:()=>navigator.language,messages:DOWNLOAD_ERRORS,warnings:WARNINGS}
// The view owns no event listeners; the picker created it from the panel and
// hands it these services once.
function view(host){
 const current=host.view
 if(!configured.has(current)){current.configurePicker(services);configured.add(current)}
 return current
}
export function renderPicker(host){return view(host).renderPicker(host)}
export function patchPickerProgress(host,engine){return view(host).patchPickerProgress(host,engine)}
export function rowPicker(host,engine,voice){return view(host).pickerRow(host,engine,voice)}
