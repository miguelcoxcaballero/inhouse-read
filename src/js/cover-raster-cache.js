import { needRustShelf } from './rust-shelf.js';

// Rust retains browser texture handles and owns the pixel budget, recency,
// replacement and disposal decisions. No decoded pixels cross into WASM.
let cache;
const policy = () => cache ||= new (needRustShelf().RustCoverRasterCache)();
export const reuseCoverRaster = (owner, key, build) => policy().reuse(owner, key, build);
export const releaseCoverRaster = owner => cache?.release(owner);
