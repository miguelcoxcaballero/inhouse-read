import {expect,it,vi} from 'vitest'
import {rustShelf as rust} from './helpers/rust-shelf-ready.js'
const model=(resolution=0)=>({userData:{overview:false,inspectionResolution:resolution,dispose:vi.fn()},removeFromParent:vi.fn()})
const host=()=>({batchQuality:true,invalidateCurrent:vi.fn(),makeModel:vi.fn(entry=>model(entry.inspectionResolution)),cancelReplacement:vi.fn(),releaseCandidate:vi.fn(),watch:vi.fn(),notify:vi.fn(),disposed:false,programsChanged:vi.fn(),furniture:{add:vi.fn()}})
it('prepares one exact quality candidate and keeps the visible book until ready',()=>{
 const env=host(), previous=model(), entry={kind:'book',model:previous,overview:false,inspectionResolution:1024}
 rust.scene_prepare_quality(entry,env)
 const replacement=entry.replacement
 expect(entry.model).toBe(previous)
 expect(env.makeModel).toHaveBeenCalledTimes(1)
 rust.scene_prepare_quality(entry,env)
 expect(env.makeModel).toHaveBeenCalledTimes(1)
 rust.scene_apply_quality(entry,env)
 expect(entry.model).toBe(previous)
 rust.scene_quality_complete(entry,env,replacement,previous,false,true,false)
 expect(env.notify).toHaveBeenCalledOnce()
 rust.scene_apply_quality(entry,env)
 expect(entry.model).toBe(replacement)
 expect(env.furniture.add).toHaveBeenCalledExactlyOnceWith(replacement)
 expect(previous.userData.dispose).toHaveBeenCalledOnce()
 expect(env.programsChanged).toHaveBeenCalledOnce()
 expect(entry.qualityReplacement).toBe(false)
})
it('does not install a stale result after another zoom or scene disposal',()=>{
 for(const disposed of [true,false]){
  const env=host(), old=model(), pending=model(1024), entry={model:disposed?old:model(),replacement:pending}
  env.disposed=disposed
  rust.scene_quality_complete(entry,env,pending,old,false,true,false)
  expect(env.releaseCandidate).toHaveBeenCalledExactlyOnceWith(pending)
  expect(env.notify).not.toHaveBeenCalled()
 }
})
it('keeps exact plant geometry and commits only the prepared surface maps',()=>{
 const env=host(), plan={ready:Promise.resolve(true),apply:vi.fn(),dispose:vi.fn()}, previous=model()
 previous.userData.prepareSurfaceQuality=vi.fn(()=>plan)
 const entry={kind:'plant',model:previous,overview:false,inspectionResolution:256}
 rust.scene_prepare_quality(entry,env)
 const pending=entry.plantQuality
 expect(env.makeModel).not.toHaveBeenCalled()
 rust.scene_quality_complete(entry,env,pending,previous,true,true,false)
 rust.scene_apply_quality(entry,env)
 expect(entry.model).toBe(previous)
 expect(plan.apply).toHaveBeenCalledOnce()
 expect(plan.dispose).toHaveBeenCalledOnce()
 expect(entry.plantQuality).toBeNull()
})
it('batches staggered decodes with a fixed deadline and immediately releases the final quality',()=>{
 const a={qualityReplacement:true,replacementReady:true},b={qualityReplacement:true,replacementReady:false},state={deadline:0}
 expect(rust.scene_quality_delay([a,b],state,false,100)).toBe(48)
 expect(rust.scene_quality_delay([a,b],state,false,125)).toBe(23)
 expect(rust.scene_quality_delay([a,b],state,false,150)).toBe(0)
 b.replacementReady=true
 expect(rust.scene_quality_delay([a,b],state,false,151)).toBe(0)
 expect(state.deadline).toBe(0)
 b.replacementReady=false
 expect(rust.scene_quality_delay([a,b],state,false,200)).toBe(48)
 expect(rust.scene_quality_delay([a,b],state,true,201)).toBe(0)
 expect(state.deadline).toBe(0)
})
it('retains the original candidate guards for an away or dragging book',()=>{
 for(const klass of ['is-away','is-dragging']){
  const env=host(),node=document.createElement('button'),old=model(),replacement=model(1024)
  node.className=klass
  const entry={node,model:old,replacement,qualityReplacement:true,replacementReady:true,overview:false,inspectionResolution:1024}
  rust.scene_apply_quality(entry,env)
  expect(entry.model).toBe(old)
  node.className=''
  rust.scene_apply_quality(entry,env)
  expect(entry.model).toBe(replacement)
 }
})

it('requests the unchanged 2048-pixel inspection target and does not recreate matching models',()=>{
 const env=host(),entry={kind:'book',model:model(),overview:false,inspectionResolution:0}
 rust.scene_update_quality(entry,env,false,2048)
 expect(entry.inspectionResolution).toBe(2048)
 expect(entry.replacement.userData.inspectionResolution).toBe(2048)
 const pending=entry.replacement,previous=entry.model
 rust.scene_quality_complete(entry,env,pending,previous,false,true,false)
 rust.scene_update_quality(entry,env,false,2048)
 expect(entry.model).toBe(pending)
 rust.scene_update_quality(entry,env,false,2048)
 expect(env.makeModel).toHaveBeenCalledTimes(1)
})

it('keeps the previous cover when preparation fails and releases rejected candidates',()=>{
 for(const rejected of [false,true]){
  const env=host(),old=model(),entry={kind:'book',model:old,overview:false,inspectionResolution:1024,coverUrl:'blob:cover'}
  rust.scene_prepare_quality(entry,env)
  rust.scene_quality_complete(entry,env,entry.replacement,old,false,false,rejected)
  expect(entry.model).toBe(old)
  expect(env.cancelReplacement).toHaveBeenCalledExactlyOnceWith(entry)
  expect(env.notify).not.toHaveBeenCalled()
 }
})
it('retains no JavaScript handles across repeated quality transactions',()=>{
 const before=rust.shelf_live_handles()
 for(let i=0;i<1000;i++){
  const env=host(),old=model(),entry={kind:'book',model:old,overview:false,inspectionResolution:1024}
  rust.scene_prepare_quality(entry,env)
  rust.scene_quality_complete(entry,env,entry.replacement,old,false,true,false)
  rust.scene_apply_quality(entry,env)
 }
 expect(rust.shelf_live_handles()).toBe(before)
})

it('does not repaint invisible preparation and still paints updates of the visible book',()=>{
 const env=host(),previous=model(),pending=model(1024),entry={model:previous,replacement:pending,qualityReplacement:true,replacementReady:false}
 rust.scene_quality_invalidate(entry,pending,env)
 expect(env.notify).not.toHaveBeenCalled();expect(env.invalidateCurrent).not.toHaveBeenCalled()
 entry.replacementReady=true;rust.scene_quality_invalidate(entry,pending,env)
 expect(env.notify).toHaveBeenCalledOnce()
 rust.scene_quality_invalidate(entry,previous,env)
 expect(env.invalidateCurrent).toHaveBeenCalledExactlyOnceWith(entry)
 env.batchQuality=false;rust.scene_quality_invalidate(entry,pending,env)
 expect(env.invalidateCurrent).toHaveBeenCalledTimes(2)
})

it('retains the last finger frame until the final plant or book map is ready',()=>{
 const scene=new rust.RustScene(390,700,390,200,false,true,0)
 const entries=[{qualityReplacement:true,replacementReady:true},{plantQuality:{ready:false}}],state={paintDeadline:0}
 expect(rust.scene_quality_hold(entries,state,scene,true,100)).toBe(240)
 expect(rust.scene_quality_hold(entries,state,scene,true,200)).toBe(140)
 entries[1].plantQuality.ready=true
 expect(rust.scene_quality_hold(entries,state,scene,true,210)).toBe(0)
 expect(state.paintDeadline).toBe(0);scene.free()
})
it('never holds other motion and bounds a stalled decoder without changing texture targets',()=>{
 const scene=new rust.RustScene(390,700,390,200,false,true,0)
 const entries=[{qualityReplacement:true,replacementReady:false,inspectionResolution:2048}],state={paintDeadline:0}
 expect(rust.scene_quality_hold(entries,state,scene,true,10)).toBe(240)
 expect(rust.scene_quality_hold(entries,state,scene,true,251)).toBe(0)
 expect(entries[0].inspectionResolution).toBe(2048)
 scene.setInspection(2,0,0,true)
 expect(rust.scene_quality_hold(entries,state,scene,true,252)).toBe(0)
 expect(rust.scene_quality_hold(entries,state,scene,false,252)).toBe(0)
 expect(state.paintDeadline).toBe(0);scene.free()
})
