// FROZEN copies of the constructors of SynthClient (src/js/readers/neural-voice/client.js) and NativeSynthClient
// (native-client.js) as they were before they moved to rust-ui client_shells.rs. `ui` (it was the module import), the
// ledger's class and `kit` (the modules native-client.js imported) are passed in; nothing else differs. They are the
// reference of client-shells.test.js: do not edit them to follow production.
export function referenceSynthConstruct(ui, VoiceClientPlan, { createWorker, ortBase, phonBase, readModel, readConfig, readPhonemizerModel = async () => null, readRuntimeAssets = async () => null, onStage = null }) {
    Object.assign(this, { createWorker, ortBase, phonBase, readModel, readConfig, readPhonemizerModel, readRuntimeAssets, onStage })
    this.worker = null
    this.plan = new VoiceClientPlan(() => ui.synth_client_error('init-failed', 'worker was released'))
    this.calls = new Map()  // id -> {resolve, reject} for init/load/free
    this.jobs = new Map()   // id -> handlers of a running synth
    this.loaded = null      // piperId whose session the worker holds
    this.ready = null       // promise of init
    this.loading = null     // {piperId, promise}
    this.preparationChain = Promise.resolve()
    this.preparations = new Set()
  }

const failure=message=>Object.assign(new Error(message),{code:'init-failed'})
export function referenceNativeConstruct(kit,{store,phonBase,env=globalThis,createOrt=kit.createNativeOrt,createPhon=kit.createPhonemizer}={}) {
    Object.assign(this,{store,phonBase,env,createOrt,createPhon})
    this.plan=new kit.VoiceClientPlan(()=>failure('Voice released'),{},true);this.jobs=new Map();this.loading=null;this.loaded=null;this.config=null;this.ort=null
    this.chain=Promise.resolve();this.preparationChain=Promise.resolve()
  }
