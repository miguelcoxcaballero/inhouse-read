import {getRustUI} from '../rust-ui.js'

// Every reader component is created after the lazy reader has awaited the Rust
// UI module (reader-experience-lazy.js), so a missing module is a programming
// error, never a state to work around with a second implementation.
export function readerUI(){
 const ui=getRustUI()
 if(!ui)throw new Error('Rust UI is not loaded')
 return ui
}
