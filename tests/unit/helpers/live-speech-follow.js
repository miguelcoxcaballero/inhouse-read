// Test harness: the argument defaults the readers' callers used to get from src/js/readers. Production calls the Rust export directly.
import {readerUI} from '../../../src/js/readers/rust-ui-required.js'

// Keep all lines of a spoken sentence visible when it fits. A longer sentence
// starts near the top; it must not force its first line above the viewport.
export function speechFollowOffset(rects,box){return readerUI().speech_follow(rects,box)}
