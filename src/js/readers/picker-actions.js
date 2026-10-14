import {readerUI} from './rust-ui-required.js'
import {neuralEngine,neuralVoiceList} from './neural-runtime.js'
import {declaredLanguage,langBase,isNeuralId} from './voice-catalog.js'
import {DOWNLOAD_ERRORS} from './picker-messages.js'
export function clickPicker(host,event){return readerUI().picker_click(host,event)}
export function cancelPickerDownload(host,id){return readerUI().picker_cancel(host,id,neuralEngine)}
export function namePickerVoice(id){return readerUI().picker_voice_name(id,neuralVoiceList)}
export async function installPickerVoice(host,id){
 const ui=readerUI(),context=ui.picker_install_begin(host,id,neuralEngine,isNeuralId,()=>new AbortController());if(!context)return
 try{await context.task;ui.picker_install_done(host,id,context,declaredLanguage,langBase,neuralVoiceList)}catch(error){ui.picker_install_error(host,id,context,error,DOWNLOAD_ERRORS)}
}
export function usePickerVoice(host,id){return readerUI().picker_use(host,id,neuralEngine)}
export async function removePickerVoice(host,id){
 const ui=readerUI(),context=ui.picker_remove_begin(host,id,neuralEngine,neuralVoiceList);if(!context)return
 try{await context.engine.remove(id)}catch{}
 ui.picker_remove_done(host,id,context)
}
