import {describe,it,expect} from 'vitest'
import {readFileSync} from 'node:fs'

// Loading states are neutral placeholder blocks (.ihr-skeleton, src/css/base.css), not sentences. The page's own
// markup carries the first ones, so they are there before any script has run; the sentence each replaces stays
// for assistive technology.
const html=readFileSync('index.html','utf8'),base=readFileSync('src/css/base.css','utf8')
const page=new DOMParser().parseFromString(html,'text/html')

describe('loading placeholders in the page markup',()=>{
 it('draws the opening book as hidden bars under a status that still says what is happening',()=>{
  const loading=page.getElementById('reader-loading')
  expect(loading.getAttribute('role')).toBe('status');expect(loading.hidden).toBe(true)
  expect(loading.textContent).toBe('Abriendo el libro…')
  expect(loading.querySelector('.visually-hidden').textContent).toBe('Abriendo el libro…')
  const bars=[...loading.querySelectorAll('.ihr-skeleton')]
  expect(bars.length).toBeGreaterThanOrEqual(6)
  for(const bar of bars){expect(bar.getAttribute('aria-hidden')).toBe('true');expect(bar.textContent).toBe('')}
 })
 it('starts the reader title as a busy placeholder that keeps its sentence',()=>{
  const title=page.getElementById('reader-top-title')
  expect(title.getAttribute('aria-busy')).toBe('true');expect(title.textContent).toBe('Abriendo libro…')
  expect(base).toContain('#reader-top-title[aria-busy="true"]')
 })
 it('says nothing in the account menu while nothing is happening',()=>{
  const status=page.getElementById('drive-sync-status')
  expect(status.textContent).toBe('');expect(status.getAttribute('role')).toBe('status')
  expect(readFileSync('src/css/app.css','utf8')).toContain('.drive-sync-status:empty { display:none; }')
 })
})

describe('the shared placeholder style',()=>{
 const rule=base.slice(base.indexOf('.ihr-skeleton,'))
 const selectors=text=>text.slice(0,text.indexOf('{')).split(',\n').map(part=>part.trim()).filter(Boolean)
 it('hides the sentence from sight only: it is not removed from the accessibility tree',()=>{
  const body=rule.slice(rule.indexOf('{'),rule.indexOf('}'))
  expect(body).toContain('-webkit-text-fill-color: transparent')
  expect(body).not.toMatch(/display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0/)
 })
 it('takes its tone from the ink of the surface it is on, so both themes and every reading paper are covered',()=>{
  const body=rule.slice(rule.indexOf('{'),rule.indexOf('}'))
  expect(body).toContain('color-mix(in srgb, currentColor 10%, transparent)')
  expect(body).not.toMatch(/#fff|#000|white|black/)
 })
 it('is a still block when motion is reduced, in every state that takes the animated style',()=>{
  const reduced=base.slice(base.lastIndexOf('@media (prefers-reduced-motion: reduce)'))
  const still=reduced.slice(reduced.indexOf('.ihr-skeleton,'))
  expect(still.slice(still.indexOf('{'),still.indexOf('}'))).toContain('animation: none')
  expect(selectors(still)).toEqual(selectors(rule))
 })
 it('keeps the states that need :has() from invalidating the rule where :has() is unknown',()=>{
  const needing=selectors(rule).filter(selector=>selector.includes(':has('))
  expect(needing.length).toBeGreaterThan(0)
  for(const selector of needing)expect(selector).toMatch(/^:where\(.*\)$/)
 })
})
