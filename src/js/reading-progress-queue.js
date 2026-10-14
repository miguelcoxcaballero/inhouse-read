import {getRustUI} from './rust-ui.js'

// Every writer (a reading position, a book's own settings) lives behind the reader,
// which is built only once the Rust UI module is in, so one native queue serialises
// all books: a newer position never overtakes an in-flight local save. Without the
// module the write rejects like a failed commit, which every caller already handles.
export function createReadingProgressQueue(library,{onSaved=()=>{}}={}){
 let native
 const queue=()=>{
  if(native)return native
  const Native=getRustUI()?.RustReadingProgressQueue
  if(!Native)throw new Error('La cola de progreso necesita el módulo Rust de interfaz')
  return native=new Native(
   (id,fraction,locator)=>library.updateProgress(id,fraction,locator),
   (id,fields)=>library.patch(id,{...fields,progressUpdatedAt:Date.now(),progressDirty:true}),onSaved)
 }
 const guarded=write=>{try{return write(queue())}catch(error){return Promise.reject(error)}}
 return {
  updateProgress:(id,fraction,locator)=>guarded(owner=>owner.updateProgress(id,fraction,locator)),
  patch:(id,fields)=>guarded(owner=>owner.patch(id,{...fields})),
  get:id=>native?.get(id)
 }
}
