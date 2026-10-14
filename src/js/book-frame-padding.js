import { core, scratch, scratchPointer } from './catalogue-core.js'

// Reserve at most 16 empty logical pixels across a one-axis native shrink; the
// decision is the Rust core's (rust-core/src/frame_padding.rs).
const number = value => typeof value === 'number' ? value : NaN
const read = (frame, previous, ratio, physical, allowed) => [allowed ? 1 : 0, number(frame?.width), number(frame?.height),
  number(previous?.x), number(previous?.y), number(ratio), number(physical?.width), number(physical?.height)]

export function paddedBookFrameWidth(frame, previous, ratio, physical, allowed) {
  return core.padded_frame_width(...read(frame, previous, ratio, physical, allowed)) === 1 ? previous.x : frame.width
}

// Keep small blank rows as well, but never retain a page-sized framebuffer.
export function paddedBookFrameSize(frame, previous, ratio, physical, allowed) {
  const original = {width:frame.width, height:frame.height}
  if (core.padded_frame_size(...read(frame, previous, ratio, physical, allowed), scratchPointer) !== 1) return original
  const [width, height] = scratch()
  return {width, height}
}
