import {getRustShelf} from '../rust-shelf.js'
import {getRustUI} from '../rust-ui.js'

// Both builds of rust-ui answer the decisions around the numeric core's kernels (format_detect.rs):
// the shelf's, loaded before its first frame (a book is imported only after it), and the reader's.
// Neither being loaded is an error, never a second path.
export function coreBridge(){
 const native=getRustShelf()||getRustUI()
 if(!native)throw new Error('Rust UI is not loaded')
 return native
}
