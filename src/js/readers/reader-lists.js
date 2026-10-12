import {getRustUI} from '../rust-ui.js'
import {LegacyReaderLists} from './reader-lists-legacy.js'

// DOM and listener ownership only; the reader retains navigation and storage.
export class ReaderLists {
  constructor(panel) {
    const Lists=getRustUI()?.RustReaderLists || LegacyReaderLists
    return new Lists(panel)
  }
}
