import { readerUI } from './rust-ui-required.js'

// A paginator can briefly report no anchor during layout or replacement. Such a
// notification must not erase the last location committed on device: which
// fraction and locator may be written down is Rust (persistable_* in rust-ui).
// The frozen original is tests/unit/helpers/reference-persistable-position.js.
export const persistablePosition = location => readerUI().persistable_position(location)

export const persistableRelocation = (notice, engine) => readerUI().persistable_relocation(notice, engine)
