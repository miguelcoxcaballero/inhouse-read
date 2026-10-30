import {getRustUI} from '../rust-ui.js'

// Every reader component is created after the lazy reader has awaited the Rust
// UI module (reader-experience-lazy.js), so a missing module is a programming
// error, never a state to work around with a second implementation.
export function readerUI(){
 const ui=getRustUI()
 if(!ui)throw new Error('Rust UI is not loaded')
 return ui
}

/**
 * Methods of `Class` that a Rust dispatcher answers: `ui[dispatch](this, name, args, kit, ui)`.
 * `names` is a space-separated list; a leading `~` marks an async method (a missing module then
 * rejects its promise instead of throwing) and a leading `.` a getter. Like class members they
 * are not enumerable.
 */
export function rustMethods(Class,dispatch,names,kit){
 const call=(host,name,args)=>{const ui=readerUI();return ui[dispatch](host,name,args,kit,ui)}
 for(const entry of names.trim().split(/\s+/)){
  const name=entry.replace(/^[~.]/,''),kind=entry[0]
  const descriptor=kind==='.'?{get(){return call(this,name,[])}}
   :{value:kind==='~'?async function(...args){return call(this,name,args)}:function(...args){return call(this,name,args)},writable:true}
  Object.defineProperty(Class.prototype,name,{...descriptor,configurable:true})
 }
}
