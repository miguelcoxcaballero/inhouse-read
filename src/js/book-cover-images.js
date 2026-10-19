import * as THREE from 'three';
import {releaseCoverRaster} from './cover-raster-cache.js';
import {needRustShelf} from './rust-shelf.js';

let bindings;
function host() {
  const rust=needRustShelf();
  return bindings ||= {
    load:(url,ready,error)=>new THREE.TextureLoader().load(url,ready,undefined,error),
    releaseRaster:releaseCoverRaster,
    loaded:rust.cover_image_loaded, failed:rust.cover_image_failed, release:rust.cover_image_release,
    warmDone:rust.cover_warm_done, warmFailed:rust.cover_warm_failed, warmRelease:rust.cover_warm_release,
  };
}
export function acquireCoverImage(url,onImage,onError) {
  return needRustShelf().cover_image_acquire(host(),url,onImage,onError);
}
// Rust owns each shared decode lease through preparation and model adoption.
export function warmShelfCover(url) { return needRustShelf().cover_image_warm(host(),url); }
export const loadedShelfCover = url => needRustShelf().cover_image_loaded_for(url);
