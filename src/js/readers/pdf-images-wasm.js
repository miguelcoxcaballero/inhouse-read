import {getRustCore} from '../rust-core.js';
import {coreBridge} from './core-bridge.js';

// rust-core pdf_images.rs, driven by rust-ui pdf_core_bridge.rs (up to a million pictures per
// call for the bounds, 32768 per part for the clipping paths).
/** Fresh host-owned bounds; undefined when the kernel cannot answer, [] for a page without image regions. */
export const rustPDFImageRects=(coordinates,width,height)=>coreBridge().pdf_core_image_rects(getRustCore(),coordinates,width,height,false);
/** Ordered image clipping paths; an empty typed array is a valid result. */
export const rustPDFImagePaths=(coordinates,width,height)=>coreBridge().pdf_core_image_paths(getRustCore(),coordinates,width,height,false);
/** Composite illustration bounds of a page. An unusable page size has no visible regions. */
export const pdfImageRects=(coordinates,width,height)=>coreBridge().pdf_core_image_rects(getRustCore(),coordinates,width,height,true);
/** Clipping paths of every picture footprint, whatever their number. A canvas without pixels has no path to clip. */
export const pdfImagePaths=(coordinates,width,height)=>coreBridge().pdf_core_image_paths(getRustCore(),coordinates,width,height,true);
