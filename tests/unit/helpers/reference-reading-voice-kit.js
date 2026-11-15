// FROZEN copy of the doorways of the kit in src/js/readers/reading-voice.js as they were before the timers, the page
// join and the deferred failure moved to rust-ui voice_shell.rs. It is the reference of reading-voice-kit.test.js:
// do not edit it to follow production.
export const referenceVoiceKit={get clearTimeout(){return clearTimeout},get now(){return Date.now},get document(){return document},
 clearTimer:id=>clearTimeout(id),add:(a,b)=>a+b,sleep:ms=>new Promise(resolve=>setTimeout(resolve,ms)),ignore:value=>Promise.resolve(value).catch(()=>{}),
 deviceLanguage:()=>navigator.language,always:()=>true,
 joinReady:(ui,owner,promise,generation,index)=>{void promise.then(()=>ui.voice_join_ready(owner,generation,index))},
 waitStarted:(ui,owner,id)=>setTimeout(()=>ui.voice_wait_started(owner,id),900),
 synthFailed:(owner,id)=>queueMicrotask(()=>owner.engineFailed({id,reason:'synth-failed'})),
 sleepTimer:(ui,owner,ms)=>setTimeout(()=>ui.voice_sleep_expired(owner),ms)}
