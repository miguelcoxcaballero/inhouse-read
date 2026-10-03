// Keep a chapter frame in layout while its real document loads. display:none
// can defer frame navigation in a background Android WebView. Opacity prevents
// unstyled content from flashing; the original load event and layout still run.
const frameStyle = `        Object.assign(this.#iframe.style, {
            overflow: 'hidden',
            border: '0',
            display: 'none',
            width: '100%', height: '100%',
        })`
const ready = `                this.render(layout)
                this.#observer.observe(doc.body)`

export function patchFoliateFrameLoading(source) {
  const normalized = source.replaceAll('\r\n', '\n')
  if (normalized.split(frameStyle).length !== 2 || normalized.split(ready).length !== 2 ||
      !normalized.includes('class View {') || !normalized.includes('export class Paginator')) {
    throw new Error('Unexpected foliate-js frame loading: review navigation and first paint before building.')
  }
  return normalized.replace(frameStyle, frameStyle.replace("display: 'none',", "display: 'block',\n            opacity: '0',"))
    .replace(ready, `                this.render(layout)
                this.#iframe.style.opacity = '1'
                this.#observer.observe(doc.body)`)
}
