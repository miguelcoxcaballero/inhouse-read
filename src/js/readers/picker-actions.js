import {getRustUI} from '../rust-ui.js'
import {neuralEngine,neuralVoiceList} from './neural-runtime.js'
import {declaredLanguage,langBase,isNeuralId} from './voice-catalog.js'
import {LegacyActions,DOWNLOAD_ERRORS} from './picker-actions-legacy.js'
const legacy=LegacyActions.prototype
export function clickPicker(host,event){const ui=getRustUI();return ui?.picker_click?ui.picker_click(host,event):legacy.click.call(host,event)}
export function cancelPickerDownload(host,id){const ui=getRustUI();return ui?.picker_cancel?ui.picker_cancel(host,id,neuralEngine):legacy.cancel.call(host,id)}
export function namePickerVoice(id){const ui=getRustUI();return ui?.picker_voice_name?ui.picker_voice_name(id,neuralVoiceList):legacy.voiceName(id)}
export async function installPickerVoice(host,id){
 const ui=getRustUI();if(!ui?.picker_install_begin)return legacy.install.call(host,id)
 const context=ui.picker_install_begin(host,id,neuralEngine,isNeuralId,()=>new AbortController());if(!context)return
 try{await context.task;ui.picker_install_done(host,id,context,declaredLanguage,langBase,neuralVoiceList)}catch(error){ui.picker_install_error(host,id,context,error,DOWNLOAD_ERRORS)}
}
export function usePickerVoice(host,id){const ui=getRustUI();return ui?.picker_use?ui.picker_use(host,id,neuralEngine):legacy.use.call(host,id)}
export async function removePickerVoice(host,id){
 const ui=getRustUI();if(!ui?.picker_remove_begin)return legacy.remove.call(host,id)
 const context=ui.picker_remove_begin(host,id,neuralEngine,neuralVoiceList);if(!context)return
 try{await context.engine.remove(id)}catch{}
 ui.picker_remove_done(host,id,context)
}
