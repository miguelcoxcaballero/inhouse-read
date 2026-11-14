// Records what narration really does to the page of the compiled app, and who did it.
//
// The spoken sources of a reader are Rust closures bound to their state (rust-ui pdf_sources.rs): the audiobook calls
// `source.highlight(start, end)` and `source.follow(start, end)` without crossing a named wasm export, so there is no
// export left to count. What stays observable is the work itself: the Highlight handed to `CSS.highlights`, the
// registry being cleared and the reader being scrolled to keep the sentence on screen. Each record carries the wasm
// module whose frame is on the JavaScript stack of that call (`native`, null when plain JavaScript made the call), so a
// test proves that the painting was done by the Rust UI module rather than by a JavaScript twin.
//
//   await observeSpeechPaint(page, { store:'paintProof' })
//   → window.paintProof = { paints:[{ key, text, native }], clears:[{ key, native }], follows:[{ id, top, left, behavior, native }] }
export async function observeSpeechPaint(page, { store }) {
  await page.addInitScript(store => {
    const proof = window[store] = { paints:[], clears:[], follows:[] }
    // The module is named by the innermost wasm frame: "…/inhouse_read_ui_bg-<hash>.wasm:wasm-function[n]:0x…".
    const native = () => {
      const limit = Error.stackTraceLimit
      Error.stackTraceLimit = 64
      const stack = String(new Error().stack)
      Error.stackTraceLimit = limit
      const frame = /([\w.-]+?)(?:-[\w-]{8})?\.wasm:wasm-function\[/.exec(stack)
      return frame ? frame[1] : null
    }
    if (typeof HighlightRegistry === 'function') {
      const { set, delete:remove } = HighlightRegistry.prototype
      HighlightRegistry.prototype.set = function (key, highlight) {
        proof.paints.push({ key, text:[...highlight].map(range => range.toString()).join(''), native:native() })
        return set.call(this, key, highlight)
      }
      HighlightRegistry.prototype.delete = function (key) {
        proof.clears.push({ key, native:native() })
        return remove.call(this, key)
      }
    }
    const scrollBy = Element.prototype.scrollBy
    Element.prototype.scrollBy = function (...args) {
      const target = args[0]
      if (target && typeof target === 'object') proof.follows.push({ id:this.id, top:target.top, left:target.left, behavior:target.behavior, native:native() })
      return scrollBy.apply(this, args)
    }
  }, store)
}
