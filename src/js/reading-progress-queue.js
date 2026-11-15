import {bookDataModule} from './book-data-native.js'

// Per book, pending positions coalesce and settings are barriers: rust-ui/src/progress_queue.rs.
// Every caller is a flow of a module that is in, so the queue is made on first use.
export function createReadingProgressQueue(library,{onSaved=()=>{}}={}){
 let queue
 const use=()=>queue||=bookDataModule().RustReadingProgressQueue.forLibrary(library,onSaved)
 return{
  updateProgress:(id,fraction,locator)=>use().updateProgress(id,fraction,locator),
  patch:(id,fields)=>use().patch(id,fields),
  get:id=>use().get(id)
 }
}
