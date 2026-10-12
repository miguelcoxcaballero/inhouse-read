import { getRustUI } from '../rust-ui.js'
import { LegacySelectMenu } from './select-menu-legacy.js'

// Select one implementation per reader session. This keeps IDs and the single
// open-menu registry consistent even when a failed module download later recovers.
let implementation
export class SelectMenu {
  constructor({ label, extra = null, onChange = () => {} } = {}) {
    implementation ||= getRustUI()?.RustSelectMenu || LegacySelectMenu
    return implementation === LegacySelectMenu
      ? new LegacySelectMenu({ label, extra, onChange })
      : new implementation(label, extra, onChange)
  }
}
