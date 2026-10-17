import { readFileSync } from 'node:fs';
let policy;
// Discovery runs before the build in a clean checkout. Load the generated
// module only when an actual test needs measured metadata, never on --list.
function metadataPolicy(){
 return policy ||= (async()=>{
  const native=await import('../../../src/wasm/shelf/inhouse_read_shelf.js');
  native.initSync({module:readFileSync('src/wasm/shelf/inhouse_read_shelf_bg.wasm')});
  const {loadRustShelf}=await import('../../../src/js/rust-shelf.js');
  await loadRustShelf();return import('../../../src/js/book-length.js');
 })();
}
/** Scene fixtures define an already measured paper volume. Their tiny PDFs
 * supply reader/cover content; extraction and migration are tested separately. */
export async function settledGeometryLength(words,revision='settled-geometry-fixture'){
 const {completeWordCount}=await metadataPolicy();
 return {...completeWordCount(words),contentRevision:revision,wordCountContentRevision:revision};
}
