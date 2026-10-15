import { RATE_STEPS } from './reading-preferences.js'
import { readerUI } from './rust-ui-required.js'

// The reading panel's structure and its line icons are owned by the Rust UI
// module (reader_markup, reader_panel.html); this is only the way to ask for them.
export const readerIcon = name => readerUI().reader_icon(name)
export const readerPanelMarkup = () => readerUI().reader_panel_markup(RATE_STEPS)
