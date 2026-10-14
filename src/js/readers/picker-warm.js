import {readerUI} from './rust-ui-required.js'
import {neuralEngine,loadNeural} from './neural-runtime.js'
const ignore=value=>Promise.resolve(value).catch(()=>{})
const readUsed=()=>localStorage.getItem('inhouse-read-neural-used'),writeUsed=()=>localStorage.setItem('inhouse-read-neural-used','1')
export function contextPicker(host){return readerUI().picker_warm_context(host)}
export function currentPicker(host,context){return readerUI().picker_warm_current(host,context)}
export function usedPicker(host){return readerUI().picker_used(readUsed)}
export function warmPicker(host){const ui=readerUI();return ui.picker_warm(host,(owner,context)=>{const run=()=>ui.picker_warm_fire(owner,context);return typeof requestIdleCallback==='function'?{idle:true,id:requestIdleCallback(run,{timeout:2500})}:{idle:false,id:setTimeout(run,800)}})}
export function cancelPicker(host){return readerUI().picker_cancel_warm(host,typeof cancelIdleCallback==='function'?cancelIdleCallback:null,clearTimeout)}
export function refreshPicker(host,warm){const ui=readerUI();return ui.picker_refresh(host,warm,(owner,context,value)=>loadNeural().then(()=>ui.picker_loaded(owner,context,value),()=>{}))}
export function attachPicker(host,warm){const ui=readerUI();return ui.picker_attach(host,warm,neuralEngine,(owner,engine)=>{engine.addEventListener('change',()=>owner.changed());engine.addEventListener('status',()=>ui.picker_engine_status(owner,engine,writeUsed))},(owner,engine,context,value)=>Promise.resolve(engine.refresh?.()).catch(()=>{}).then(()=>ui.picker_engine_refreshed(owner,context,value)))}
export function warmUpPicker(host){return readerUI().picker_warm_up(host,neuralEngine,ignore,(owner,context)=>()=>owner.isWarmCurrent(context))}
export function changedPicker(host){const ui=readerUI();return ui.picker_changed(host,neuralEngine,owner=>requestAnimationFrame(()=>ui.picker_paint_frame(owner)))}
export function paintPicker(host){return readerUI().picker_paint(host,neuralEngine)}
