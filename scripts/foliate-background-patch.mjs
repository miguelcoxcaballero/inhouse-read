// A hidden WebView suspends visual requestAnimationFrame callbacks. Commit the
// same exact endpoint when hidden, so Foliate's awaited page/follow operation
// can finish and reading can reach the next chapter. Visible easing is intact.
const animation = /const animate = \(a, b, duration, ease, render\) => new Promise\(resolve => \{\r?\n[\s\S]*?\r?\n\}\)/g
const replacement = `const animate = (a, b, duration, ease, render) => new Promise(resolve => {
    let start, frame, finished = false
    const cleanup = () => {
        if (frame != null) cancelAnimationFrame(frame)
        document.removeEventListener('visibilitychange', visibility)
    }
    const finish = () => {
        if (finished) return
        finished = true
        cleanup()
        render(b)
        resolve()
    }
    const visibility = () => { if (document.hidden) finish() }
    const step = now => {
        if (finished) return
        start ??= now
        const fraction = Math.min(1, (now - start) / duration)
        render(lerp(a, b, ease(fraction)))
        if (fraction < 1) frame = requestAnimationFrame(step)
        else { finished = true; cleanup(); resolve() }
    }
    document.addEventListener('visibilitychange', visibility)
    if (document.hidden) finish()
    else frame = requestAnimationFrame(step)
})`
export function patchFoliateBackground(source) {
  const matches = [...source.matchAll(animation)]
  if (matches.length !== 1 || !matches[0][0].includes('requestAnimationFrame(step)') || !source.includes('export class Paginator')) {
    throw new Error('Unexpected foliate-js paginator animation: review hidden-page completion before building.')
  }
  return source.replace(animation, replacement)
}
export function foliateBackgroundPatch() {
  return { name:'inhouse-read-foliate-background-follow', enforce:'pre', transform(source, id) {
    const path = id.split('?')[0].replaceAll('\\', '/')
    if (!path.endsWith('/node_modules/foliate-js/paginator.js')) return null
    return { code:patchFoliateBackground(source), map:null }
  } }
}
