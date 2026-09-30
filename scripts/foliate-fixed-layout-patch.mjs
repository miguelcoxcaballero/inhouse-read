// foliate-js 1.0.1 can receive a ResizeObserver callback between the async
// frame loads in #showSpread. Its previous #side is still set, but the next
// left/right frames are null. Keep using the upstream renderer and defer
// that incomplete render; #showSpread already renders once both frames exist.
const renderGuard = /(#render\(side = this\.#side\) \{\r?\n[ \t]*)if \(!side\) return(?=\r?$)/gm

export function patchFoliateFixedLayout(source) {
  const matches = [...source.matchAll(renderGuard)]
  if (!source.includes('export class FixedLayout extends HTMLElement') || matches.length !== 1) {
    throw new Error('Unexpected foliate-js fixed-layout renderer: review its resize guard before building Inhouse Read.')
  }
  return source.replace(renderGuard,
    '$1if (!side || (!this.#center && (!this.#left || !this.#right))) return')
}

export function foliateFixedLayoutPatch() {
  return {
    name:'inhouse-read-foliate-fixed-layout-resize',
    enforce:'pre',
    transform(source, id) {
      const path = id.split('?')[0].replaceAll('\\', '/')
      if (!path.endsWith('/node_modules/foliate-js/fixed-layout.js')) return null
      return { code:patchFoliateFixedLayout(source), map:null }
    }
  }
}
