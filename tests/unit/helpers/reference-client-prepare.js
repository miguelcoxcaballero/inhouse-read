// FROZEN copies of SynthClient.prototype.prepare (src/js/readers/neural-voice/client.js) and
// NativeSynthClient.prototype.prepare (native-client.js) as they were before their promise bookkeeping moved to rust-ui
// client_prepare.rs. `ui` is passed in (it was the module import) and `kit` (the native client's module table); nothing
// else differs. They are the reference of client-prepare.test.js: do not edit them to follow production.
export function referenceSynthPrepare(ui, piperId) {
    if (this.plan.preparing(piperId)) return this.loading.promise
    const generation = this.plan.capture()
    const work = this.preparationChain.then(() => ui.synth_client_prepare(this, piperId, generation))
    let rejectPreparation
    const promise = new Promise((resolve, reject) => {
      rejectPreparation = reject
      this.preparations.add(reject)
      work.then(resolve, reject)
    })
    this.preparationChain = promise.catch(() => {})
    this.loading = { piperId, promise }; this.plan.beginPreparation(piperId)
    const finished = () => {
      this.preparations.delete(rejectPreparation)
      if (this.loading?.promise === promise) { this.loading = null; this.plan.finishPreparation() }
    }
    promise.then(finished, finished)
    return promise
  }

export function referenceNativePrepare(ui, kit, key) {
    if(this.plan.model(8,key))return Promise.resolve(this.config)
    if(this.plan.preparing(key))return this.loading.promise
    const generation=this.plan.capture()
    const promise=this.preparationChain.then(()=>ui.native_client_prepare(this,key,generation,kit))
    this.preparationChain=promise.catch(()=>{})
    this.loading={key,promise};this.plan.beginPreparation(key)
    promise.finally(()=>{if(this.loading?.promise===promise){this.loading=null;this.plan.finishPreparation()}}).catch(()=>{})
    return promise
  }
