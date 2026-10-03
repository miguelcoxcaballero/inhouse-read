// Keep the existing reading frame between chapters. Its document still
// navigates and loads normally; old overlays and observers are released.
const create = `        if (this.#view) {
            this.#view.destroy()
            this.#container.removeChild(this.#view.element)
        }
        this.#view = new View({`
const destroy = `    destroy() {
        if (this.document) this.#observer.unobserve(this.document.body)
    }`
const load = /    async load\(src, afterLoad, beforeRender\) \{[\s\S]*?\n    \}\n(?=    render\(layout\))/g
const turn = /    async #turnPage\(dir, distance\) \{[\s\S]*?\n    \}\n(?=    async prev\(distance\))/g
const replacement = `    async load(src, afterLoad, beforeRender) {
        if (typeof src !== 'string') throw new Error(\`\${src} is not string\`)
        this.#loadAbort?.()
        this.#iframe.style.opacity = '0'
        this.#iframe.style.width = this.#iframe.style.height = '100%'
        this.#element.style.width = this.#element.style.height = '100%'
        const target = new URL(src, document.baseURI).href
        return new Promise((resolve, reject) => {
            let settled = false
            const sourceURL = () => {
                try { return this.#iframe.contentWindow?.location?.href ?? null }
                catch { return null }
            }
            // Diagnostic only: numeric phases, no text, URLs, timers or commands.
            const report = (stage, error) => {
                if (typeof globalThis.InhousePcm?.reportNavigationStage !== 'function') return
                try {
                    console.info('InhouseReadFrame ' + JSON.stringify({ stage,
                        ready: ({ loading: 1, interactive: 2, complete: 3 })[this.document?.readyState] || 0,
                        sourceMatches: sourceURL() === target,
                        errorCode: error ? ({ TypeError: 2, RangeError: 3, AbortError: 4, SecurityError: 5 })[error.name] || 1 : 0,
                    }))
                } catch {}
            }
            const cleanup = () => {
                this.#iframe.removeEventListener('load', loaded)
                this.#iframe.removeEventListener('error', failed)
                if (this.#loadAbort === abort) this.#loadAbort = null
            }
            const fail = error => {
                if (settled) return
                settled = true
                report(8, error)
                cleanup()
                reject(error)
            }
            const abort = () => fail(new DOMException('Chapter navigation cancelled', 'AbortError'))
            const failed = () => fail(new Error('No se pudo cargar el capítulo del libro.'))
            const loaded = () => {
                if (settled) return
                report(2)
                // Initial about:blank and late old-document events cannot
                // satisfy the new chapter. Keep listening for its real load.
                const current = sourceURL()
                if (current !== null && current !== target) return
                try {
                    const doc = this.document
                    if (!doc?.body) throw new Error('El capítulo no contiene un documento legible.')
                    afterLoad?.(doc)
                    report(3)
                    this.#iframe.style.display = 'block'
                    const { vertical, rtl } = getDirection(doc)
                    this.docBackground = getBackground(doc)
                    doc.body.style.background = 'none'
                    const background = this.docBackground
                    this.#iframe.style.display = 'none'
                    this.#vertical = vertical
                    this.#rtl = rtl
                    this.#contentRange.selectNodeContents(doc.body)
                    const layout = beforeRender?.({ vertical, rtl, background })
                    this.#iframe.style.display = 'block'
                    report(4)
                    this.render(layout)
                    this.#iframe.style.opacity = '1'
                    this.#observer.observe(doc.body)
                    doc.fonts.ready.then(() => { if (this.document === doc) this.expand() })
                    settled = true
                    cleanup()
                    report(5)
                    resolve()
                } catch (error) { fail(error) }
            }
            this.#loadAbort = abort
            this.#iframe.addEventListener('load', loaded)
            this.#iframe.addEventListener('error', failed)
            try { this.#iframe.src = src; report(1) }
            catch (error) { fail(error) }
        })
    }
`
export function patchFoliateRetainedFrame(input) {
  let source = input.replaceAll('\r\n','\n')
  const matches = [...source.matchAll(load)]
  if (source.split(create).length !== 2 || source.split(destroy).length !== 2 || matches.length !== 1 || [...source.matchAll(turn)].length !== 1 ||
      !matches[0][0].includes("this.#iframe.style.opacity = '1'") || source.includes('#loadAbort')) {
    throw new Error('Unexpected foliate-js chapter frame: review retained navigation before building.')
  }
  source = source.replace('    #overlayer\n', '    #loadAbort\n    #overlayer\n')
    .replace(create, create.replace('this.#container.removeChild(this.#view.element)', 'return this.#view'))
    .replace(destroy, `    destroy() {
        this.#loadAbort?.()
        if (this.document?.body) this.#observer.unobserve(this.document.body)
        this.#overlayer?.element.remove()
        this.#overlayer = null
    }`)
    .replace(load, replacement)
    .replace(turn, method => method.replace('        this.#locked = true\n', '        this.#locked = true\n        try {\n')
      .replace(/\n    \}\n$/, `
        } finally {
            this.#locked = false
            this.inhouseReadTurnStage = 0
        }
    }
`))
  return source
}
