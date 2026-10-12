const listeners=new Set()
// Register only while getRustUI() is null, in the same synchronous turn.
// This does not start another download or extend the reader's startup deadline.
export function onRustUIReady(listener){
 listeners.add(listener)
 return()=>listeners.delete(listener)
}
export function notifyRustUIReady(ui){
 const ready=[...listeners];listeners.clear()
 for(const listener of ready)try{listener(ui)}catch{/* Keep working fallback controls if adoption fails. */}
}
