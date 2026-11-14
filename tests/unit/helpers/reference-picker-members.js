// FROZEN from src/js/readers/neural-picker.js: `install` and `remove` of NeuralVoicePicker as they were before
// rust-ui picker_members.rs ran them (the JavaScript methods waited between exports of picker_actions.rs). The
// doorways the module imported are handed in. Do not edit: picker-members-wasm.test.js compares the Rust members with these.
import { readerUI } from '../../../src/js/readers/rust-ui-required.js'

export async function referenceInstall(picker, id, { neuralEngine, isNeuralId, declaredLanguage, langBase, neuralVoiceList, DOWNLOAD_ERRORS }) {
  const ui=readerUI(),context=ui.picker_install_begin(picker,id,neuralEngine,isNeuralId,()=>new AbortController());if(!context)return
  try{await context.task;ui.picker_install_done(picker,id,context,declaredLanguage,langBase,neuralVoiceList)}catch(error){ui.picker_install_error(picker,id,context,error,DOWNLOAD_ERRORS)}
}
export async function referenceRemove(picker, id, { neuralEngine, neuralVoiceList }) {
  const ui=readerUI(),context=ui.picker_remove_begin(picker,id,neuralEngine,neuralVoiceList);if(!context)return
  try{await context.engine.remove(id)}catch{}
  ui.picker_remove_done(picker,id,context)
}
