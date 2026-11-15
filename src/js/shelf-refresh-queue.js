import {getRustShelf,whenRustShelf} from './rust-shelf.js'
const setDefaultTimer=(callback,ms)=>setTimeout(callback,ms)
const clearDefaultTimer=id=>clearTimeout(id)

// Background notifications coalesce and reads never overlap: rust-ui/src/refresh_queue.rs, in the shelf
// module. A page's first read cannot wait for that module (it is what starts the library read), so an
// urgent request made before it is in is read from here; the module's queue then takes over the read still
// running and everything asked meanwhile, each request with the time it has already waited.
export function createShelfRefreshQueue({perform,delay=80,setTimer=setDefaultTimer,clearTimer=clearDefaultTimer}={}){
 if(typeof perform!=='function')throw new TypeError('Shelf refresh needs a perform callback')
 let native=null,disposed=false,running=false,early=null
 const adopt=shelf=>{
  if(disposed||native)return
  native=new shelf.RustShelfRefreshQueue(perform,delay,setTimer,clearTimer)
  if(early){const asked=early;early=null;native.adopt(running,asked,Date.now())}
 }
 const read=()=>{
  const batch=early;early=[];running=true
  const done=(value,failed)=>{
   running=false
   for(const waiter of batch)failed?waiter.no(value):waiter.yes(value)
   if(native)native.resume();else if(early?.some(waiter=>waiter.urgent))read()
  }
  Promise.resolve().then(()=>disposed?undefined:perform({immediate:true})).then(value=>done(value),error=>done(error,true))
 }
 return{
  request({immediate:urgent=false}={}){
   if(disposed)return Promise.resolve()
   if(!native&&!early){const shelf=getRustShelf();if(shelf)adopt(shelf);else{early=[];whenRustShelf(adopt)}}
   const promise=native?native.request(!!urgent):new Promise((yes,no)=>early.push({yes,no,urgent:!!urgent,at:Date.now()}))
   // Notifications such as CloudSync.onChange need not await this promise.
   promise.catch(()=>{})
   if(!native&&urgent&&!running)read()
   return promise
  },
  dispose(){
   if(disposed)return
   disposed=true
   if(native){native.dispose();native.free();native=null}
   for(const waiter of early||[])waiter.yes()
   early=null
  }
 }
}
