import { readerUI } from './rust-ui-required.js'

export class SelectMenu {
  constructor({ label, extra = null, onChange = () => {} } = {}) {
    return new (readerUI().RustSelectMenu)(label, extra, onChange)
  }
}
