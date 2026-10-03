// PDF.js display rendering uses visual rAF, which a hidden WebView may suspend.
// Wake only that render task: retain display intent, pixels and visible timing.
const taskPattern = /class InternalRenderTask \{\r?\n[\s\S]*?\r?\n\}\r?\nconst version = "6\.3\.289";/g
const schedule = `  _scheduleNext() {
    if (this._useRequestAnimationFrame) {
      this.#rAF = window.requestAnimationFrame(() => {
        this.#rAF = null;
        this._nextBound().catch(this._cancelBound);
      });
    } else {
      Promise.resolve().then(this._nextBound).catch(this._cancelBound);
    }
  }`
const cancellation = `    if (this.#rAF) {
      window.cancelAnimationFrame(this.#rAF);
      this.#rAF = null;
    }`
const completion = `      if (this.operatorList.lastChunk) {
        this.gfx.endDrawing();`
const replacement = `  _scheduleNext() {
    this.#visibilityCleanup?.();
    const doc = typeof document !== "undefined" ? document : null;
    if (this._useRequestAnimationFrame && !doc?.hidden) {
      let live = true;
      const cleanup = () => {
        if (!live) return;
        live = false;
        if (this.#rAF !== null) {
          window.cancelAnimationFrame(this.#rAF);
          this.#rAF = null;
        }
        doc?.removeEventListener("visibilitychange", visibility);
        if (this.#visibilityCleanup === cleanup) this.#visibilityCleanup = null;
      };
      const advance = () => {
        if (!live || this.cancelled) return;
        cleanup();
        this._nextBound().catch(this._cancelBound);
      };
      const visibility = () => {
        if (!live || !doc.hidden) return;
        if (this.#rAF !== null) {
          window.cancelAnimationFrame(this.#rAF);
          this.#rAF = null;
        }
        Promise.resolve().then(advance).catch(this._cancelBound);
      };
      this.#visibilityCleanup = cleanup;
      doc?.addEventListener("visibilitychange", visibility);
      this.#rAF = window.requestAnimationFrame(() => {
        if (!live) return;
        this.#rAF = null;
        advance();
      });
    } else {
      Promise.resolve().then(this._nextBound).catch(this._cancelBound);
    }
  }`

export function patchPDFBackground(source) {
  const matches = [...source.matchAll(taskPattern)]
  if (matches.length !== 1) throw new Error('Unexpected PDF.js render task: review hidden-page scheduling before building.')
  let task = matches[0][0].replaceAll('\r\n', '\n')
  for (const signature of ['  #rAF = null;', schedule, cancellation, completion]) {
    if (task.split(signature).length !== 2) throw new Error('Unexpected PDF.js scheduler lifecycle: review hidden-page scheduling before building.')
  }
  task = task.replace('  #rAF = null;', '  #rAF = null;\n  #visibilityCleanup = null;')
    .replace(schedule, replacement)
    .replace(cancellation, `    this.#visibilityCleanup?.();
    if (this.#rAF !== null) {
      window.cancelAnimationFrame(this.#rAF);
      this.#rAF = null;
    }`)
    .replace(completion, `      if (this.operatorList.lastChunk) {
        this.#visibilityCleanup?.();
        this.gfx.endDrawing();`)
  return source.slice(0, matches[0].index) + task + source.slice(matches[0].index + matches[0][0].length)
}

export function pdfBackgroundPatch() {
  return { name:'inhouse-read-pdf-background-render', enforce:'pre', transform(source, id) {
    const path = id.split('?')[0].replaceAll('\\', '/')
    if (!path.endsWith('/node_modules/pdfjs-dist/legacy/build/pdf.mjs')) return null
    return { code:patchPDFBackground(source), map:null }
  } }
}
