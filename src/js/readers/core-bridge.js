import {getRustShelf} from '../rust-shelf.js'
import {getRustUI} from '../rust-ui.js'

// Both builds of rust-ui drive the numeric core's PDF kernels (pdf_core_bridge.rs): the shelf's,
// loaded before its first frame (page counts on import), and the reader's. A page is never laid
// out before one of them is ready, so neither being loaded is an error, never a second path.
export function coreBridge(){
 const native=getRustShelf()||getRustUI()
 if(!native)throw new Error('Rust UI is not loaded')
 return native
}
