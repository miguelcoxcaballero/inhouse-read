import { needRustShelf } from './rust-shelf.js';

export const CATALOG_CAMERA_MS = 480;
export const CATALOG_CAMERA_EASING = 'cubic-bezier(.65, 0, .35, 1)';
export const IDENTITY = 'translate(0px, 0px) scale(1, 1)';

/** Printed booklet face in viewport pixels, falling back to the button. */
export const bookletRect = node => needRustShelf().catalog_booklet_rect(node);

/** Native geometry for the compositor flight; empty rectangles return null. */
export const catalogCameraFrames = (booklet,page,stage) => needRustShelf().catalog_camera_frames(booklet,page,stage);
