import {getRustUI} from './rust-ui.js'
import {createLegacyShelfRefreshQueue} from './shelf-refresh-queue-legacy.js'
const setDefaultTimer=(callback,ms)=>setTimeout(callback,ms)
const clearDefaultTimer=id=>clearTimeout(id)

// An in-flight read keeps its owner until its trailing batch drains. Native
// adoption never waits for WASM or lets a newer change join an older snapshot.
export function createShelfRefreshQueue({perform,delay=80,setTimer=setDefaultTimer,clearTimer=clearDefaultTimer}={}){
 if(typeof perform!=='function')throw new TypeError('Shelf refresh needs a perform callback')
 const legacy=createLegacyShelfRefreshQueue({perform,delay,setTimer,clearTimer})
 let native=null,disposed=false
 const eligible=setTimer===setDefaultTimer&&clearTimer===clearDefaultTimer
 return{
  request({immediate:urgent=false}={}){
   if(disposed)return Promise.resolve()
   if(!native&&eligible&&legacy.idle()){
    const Native=getRustUI()?.RustShelfRefreshQueue
    if(Native&&['request','dispose','idle'].every(key=>typeof Native.prototype[key]==='function')){
     try{native=new Native(perform,delay,setTimer,clearTimer)}catch{}
     if(native)legacy.dispose()
    }
   }
   if(!native)return legacy.request({immediate:urgent})
   const promise=native.request(!!urgent);promise.catch(()=>{});return promise
  },
  dispose(){if(disposed)return;disposed=true;if(native){native.dispose();native.free();native=null}else legacy.dispose()}
 }
}
