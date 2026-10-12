import {getRustUI} from '../rust-ui.js'
import {LegacyReaderView} from './reader-view-legacy.js'

// The existing reader owns pagination, audio and persistence. This view only
// updates its existing DOM, without scheduling book rendering or moving text.
export class ReaderView {
  constructor(screen,panel,mini,returnButton) {
    const View=getRustUI()?.RustReaderView || LegacyReaderView
    return new View(screen,panel,mini,returnButton)
  }
}
