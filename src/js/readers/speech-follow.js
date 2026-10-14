import {readerUI} from './rust-ui-required.js'

// Keep all lines of a spoken sentence visible when it fits. A longer sentence
// starts near the top; it must not force its first line above the viewport.
export function speechFollowOffset(rects,box){return readerUI().speech_follow(rects,box)}
