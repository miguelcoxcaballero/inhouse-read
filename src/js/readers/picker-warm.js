import {getRustUI} from '../rust-ui.js'
import {neuralEngine,loadNeural} from './neural-runtime.js'
import {LegacyWarm} from './picker-warm-legacy.js'
const legacy=LegacyWarm.prototype,ignore=value=>Promise.resolve(value).catch(()=>{})
const readUsed=()=>localStorage.getItem('inhouse-read-neural-used'),writeUsed=()=>localStorage.setItem('inhouse-read-neural-used','1')
export function contextPicker(host){const ui=getRustUI();return ui?.picker_warm_context?ui.picker_warm_context(host):legacy.warmContext.call(host)}
export function currentPicker(host,context){const ui=getRustUI();return ui?.picker_warm_current?ui.picker_warm_current(host,context):legacy.isWarmCurrent.call(host,context)}
export function usedPicker(host){const ui=getRustUI();return ui?.picker_used?ui.picker_used(readUsed):legacy.used.call(host)}
export function warmPicker(host){const ui=getRustUI();return ui?.picker_warm?ui.picker_warm(host,(owner,context)=>{const run=()=>ui.picker_warm_fire(owner,context);return typeof requestIdleCallback==='function'?{idle:true,id:requestIdleCallback(run,{timeout:2500})}:{idle:false,id:setTimeout(run,800)}}):legacy.warm.call(host)}
export function cancelPicker(host){const ui=getRustUI();return ui?.picker_cancel_warm?ui.picker_cancel_warm(host,typeof cancelIdleCallback==='function'?cancelIdleCallback:null,clearTimeout):legacy.cancelWarm.call(host)}
export function refreshPicker(host,warm){const ui=getRustUI();return ui?.picker_refresh?ui.picker_refresh(host,warm,(owner,context,value)=>loadNeural().then(()=>ui.picker_loaded(owner,context,value),()=>{})):legacy.refresh.call(host,{warm})}
export function attachPicker(host,warm){const ui=getRustUI();return ui?.picker_attach?ui.picker_attach(host,warm,neuralEngine,(owner,engine)=>{engine.addEventListener('change',()=>owner.changed());engine.addEventListener('status',()=>ui.picker_engine_status(owner,engine,writeUsed))},(owner,engine,context,value)=>Promise.resolve(engine.refresh?.()).catch(()=>{}).then(()=>ui.picker_engine_refreshed(owner,context,value))):legacy.attach.call(host,warm)}
export function warmUpPicker(host){const ui=getRustUI();return ui?.picker_warm_up?ui.picker_warm_up(host,neuralEngine,ignore,(owner,context)=>()=>owner.isWarmCurrent(context)):legacy.warmUp.call(host)}
export function changedPicker(host){const ui=getRustUI();return ui?.picker_changed?ui.picker_changed(host,neuralEngine,owner=>requestAnimationFrame(()=>ui.picker_paint_frame(owner))):legacy.changed.call(host)}
export function paintPicker(host){const ui=getRustUI();return ui?.picker_paint?ui.picker_paint(host,neuralEngine):legacy.paint.call(host)}
