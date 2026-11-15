// What src/js/cover-relief.js exported for tests alone: the constants of the saved format and of the working
// rasters (the shelf module has its own, rust-ui/src/cover_relief.rs and relief_flow.rs) and four functions of
// the module that no page code calls by these names. The page no longer carries them.
import { needRustShelf } from '../../../src/js/rust-shelf.js';
import { COLOR_RELIEF_IDS } from '../../../src/js/cover-relief.js';

export const LEGACY_RELIEF_IDS = Object.freeze(['lettering', 'foil', 'frame', 'emblem', 'varnish', 'band', 'grain', 'panel']);
export const RELIEF_IDS = Object.freeze([...COLOR_RELIEF_IDS, ...LEGACY_RELIEF_IDS]);
export const DEFAULT_RELIEF_STRENGTH = .75;
export const DEFAULT_COLOR_TOLERANCE = 6;
export const MIN_COLOR_TOLERANCE = 1;
export const MAX_COLOR_TOLERANCE = 12;
export const WORK_SIZE = 288;
export const MAP_SIZE = 512;
// Maps store physical height in units of MAX_RELIEF_MM. New color zones use .30 mm before the renderer's
// strength multiplier for existing singles; combined colours have their own stable .16–.30 mm coating profiles.
export const MAX_RELIEF_MM = .6;

/** Each detected colour's stable printing/varnish depth and finish, from its printed HEX. */
export const colorReliefProfile = choice => needRustShelf().color_relief_profile(choice);
export const fitDimensions = (width, height, long) => needRustShelf().relief_fit_dimensions(width, height, long);
/** Convert the three material planes together without changing their pixel data. */
export const reliefPlanesToRgba = maps => needRustShelf().relief_planes_rgba(maps);
/** Pure steps the tests reach into: the colour naming. */
export const internals = { colorName:hex => needRustShelf().relief_color_name(hex) };
