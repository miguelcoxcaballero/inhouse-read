// A hidden WebView suspends visual requestAnimationFrame callbacks. Commit the
// same exact endpoint when hidden, so Foliate's awaited page/follow operation
// can finish and reading can reach the next chapter. Visible easing is intact.
import { patchFoliateTurnDiagnostics } from './foliate-turn-diagnostic-patch.mjs'
const animation = /const animate = \(a, b, duration, ease, render\) => new Promise\(resolve => \{\r?\n[\s\S]*?\r?\n\}\)/g
const cooldownCall = "if (shouldGo || !this.hasAttribute('animated')) await wait(100)"
// The 100ms lock after a settled page turn is visual pacing. Hidden pages
// must not await DOM timers that WebView may throttle or suspend after minutes.
// Finish the same awaited turn; never bypass section loading or page layout.
const cooldown = `const waitForPageCooldown = ms => new Promise(resolve => {
    let timer, finished = false
    const finish = () => {
        if (finished) return
        finished = true
        if (timer != null) clearTimeout(timer)
        document.removeEventListener('visibilitychange', visibility)
        resolve()
    }
    const visibility = () => { if (document.hidden) finish() }
    document.addEventListener('visibilitychange', visibility)
    if (document.hidden) finish()
    else timer = setTimeout(finish, ms)
})`
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
  const cooldowns = [...source.matchAll(/\bawait\s+wait\s*\(\s*100\s*\)/g)]
  if (matches.length !== 1 || !matches[0][0].includes('requestAnimationFrame(step)') || !source.includes('export class Paginator') ||
    cooldowns.length !== 1 || source.split(cooldownCall).length !== 2) {
    throw new Error('Unexpected foliate-js paginator animation/cooldown: review hidden-page completion before building.')
  }
  return source.replace(animation, `${cooldown}\n${replacement}`)
    .replace(cooldownCall, "if (shouldGo || !this.hasAttribute('animated')) await waitForPageCooldown(100)")
}
export function foliateBackgroundPatch() {
  return { name:'inhouse-read-foliate-background-follow', enforce:'pre', transform(source, id) {
    const path = id.split('?')[0].replaceAll('\\', '/')
    if (!path.endsWith('/node_modules/foliate-js/paginator.js')) return null
    return { code:patchFoliateTurnDiagnostics(patchFoliateBackground(source)), map:null }
  } }
}
