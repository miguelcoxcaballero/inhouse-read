import { afterEach, describe, expect, it, vi } from 'vitest'
import * as core from '../../src/js/reading-streak-core.js'
import * as reference from './helpers/reference-reading-streak-core.js'
import { createReadingStreak } from '../../src/js/reading-streak.js'
import { createReadingStreak as createReferenceStreak } from './helpers/reference-reading-streak.js'

// rust-ui/src/reading_streak.rs against the frozen JavaScript originals: the pure records (every
// export of reading-streak-core.js on seeded random states, odd keys and odd numbers) and the whole
// controller (header chips, timer, celebration, calendar panel, widget payloads, storage, callbacks)
// driven through the same scripted sessions with fake timers.

function random(seed) {
  let state = seed >>> 0
  return () => { state = (state + 0x6D2B79F5) >>> 0; let t = state; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296 }
}
const pick = (rng, list) => list[Math.floor(rng() * list.length)]
const same = (a, b) => { expect(JSON.stringify(a)).toBe(JSON.stringify(b)); expect(a).toEqual(b) }

const ODD_KEYS = ['2026-13-40', 'abc', '0050-01-01', '2026-1-1', '', '2026-02-30', '9999-12-31', '0000-01-01', '2026-00-00', '12345-01-01', '2026-10-23-extra', '2026-10', '1900-02-29']
const ODD_SECONDS = [0, -5, 0.5, 299.999, 300, 301.25, 86400, 90000, NaN, Infinity, -Infinity, 1e-7]

function randomKey(rng, today) {
  if (rng() < 0.12) return pick(rng, ODD_KEYS)
  return reference.addDays(today, -Math.floor(rng() * 500) + (rng() < 0.1 ? 3 : 0))
}
function rawDays(rng, today, numeric) {
  const days = {}
  const count = Math.floor(rng() * 60)
  for (let i = 0; i < count; i++) {
    const key = randomKey(rng, today)
    const value = rng() < 0.15 ? pick(rng, ODD_SECONDS) : rng() < 0.6 ? 300 : Math.floor(rng() * 400)
    days[key] = numeric || rng() < 0.85 ? value : pick(rng, ['300', null, true, [], [400], {}, '0x200', ' 310 ', undefined])
  }
  return days
}
function numericState(rng, today) {
  return { v: 1, days: rawDays(rng, today, true), best: Math.floor(rng() * 30), celebrated: rng() < 0.5 ? reference.addDays(today, -Math.floor(rng() * 5)) : '' }
}
const todays = ['2026-10-23', '2026-01-01', '2024-02-29', '2026-03-29', '2026-10-25', '2027-12-31', '2025-06-30']

describe('reading streak records', () => {
  it('days, keys and calendar arithmetic match the engine', () => {
    const rng = random(7)
    for (let i = 0; i < 4000; i++) {
      const key = i % 3 === 0 ? pick(rng, ODD_KEYS) : reference.addDays(pick(rng, todays), Math.floor(rng() * 2000) - 1000)
      const delta = pick(rng, [-1, 1, 0, -420, 7, -6, Math.floor(rng() * 800) - 400, 0.5, NaN])
      expect(core.addDays(key, delta)).toBe(reference.addDays(key, delta))
      const parsed = core.parseDay(key), frozen = reference.parseDay(key)
      expect(Object.is(parsed.getTime(), frozen.getTime())).toBe(true)
    }
    for (let i = 0; i < 2000; i++) {
      const time = rng() < 0.1 ? pick(rng, [NaN, 0, -1, 8.64e15, -8.64e15, 253402300799999]) : (rng() * 2 - 0.5) * 2e12
      const date = new Date(time)
      expect(core.dayKey(date)).toBe(reference.dayKey(date))
    }
    expect(core.dayKey()).toBe(reference.dayKey())
  })

  it('normalise, parse, merge, prune and sync give the same states', () => {
    const rng = random(11)
    for (let i = 0; i < 1500; i++) {
      const today = pick(rng, todays)
      const raw = { v: pick(rng, [1, 2, undefined]), days: rawDays(rng, today, false), best: pick(rng, [0, 3, 12.7, -1, NaN, '9', undefined, Infinity]), celebrated: pick(rng, ['', today, 'x', 5, undefined, reference.addDays(today, -1)]) }
      same(core.normalizeStreak(raw), reference.normalizeStreak(raw))
      for (const odd of [null, undefined, 5, 'text', [], () => 1, { days: null }, { days: 'x' }]) same(core.normalizeStreak(odd), reference.normalizeStreak(odd))
      const text = rng() < 0.2 ? pick(rng, ['', '{', 'null', '[]', '{"days":{"2026-01-01":"300"}}', undefined, null]) : JSON.stringify(raw)
      same(core.parseStreak(text), reference.parseStreak(text))
      const others = [numericState(rng, today), raw, numericState(rng, today)].slice(0, 1 + Math.floor(rng() * 3))
      same(core.mergeStreaks(...others), reference.mergeStreaks(...others))
      const state = numericState(rng, today)
      if (rng() < 0.3) state.extra = 'kept'
      same(core.pruneStreak(state, today), reference.pruneStreak(state, today))
      same(core.syncedStreak(state), reference.syncedStreak(state))
      same(core.streakInfo(state, today), reference.streakInfo(state, today))
      const key = randomKey(rng, today)
      expect(core.isComplete(state, key)).toBe(reference.isComplete(state, key))
    }
  })

  it('reading, weeks, months, clocks and words match', () => {
    const rng = random(23)
    for (let i = 0; i < 1500; i++) {
      const today = pick(rng, todays)
      const state = numericState(rng, today)
      if (rng() < 0.5) state.days[today] = pick(rng, [290, 299.5, 0.25, 300, 120])
      const seconds = pick(rng, [0.4, 1, 9.75, 2, 30, 0.001, 300])
      const ours = core.addReading(state, seconds, today), theirs = reference.addReading(state, seconds, today)
      same(ours, theirs)
      same(core.weekDays(state, today), reference.weekDays(state, today))
      const year = pick(rng, [2024, 2025, 2026, 2027, 1999, 50]), month = pick(rng, [0, 1, 2, 9, 10, 11, -1, 12, 13])
      same(core.monthGrid(state, year, month, today), reference.monthGrid(state, year, month, today))
    }
    for (const value of [0, 1, 59.5, 60, 61, 299.4, 299.5, 300, -3, -0.5, NaN, Infinity, 1e21, 123456.789, 0.49999999999999994, '75', null])
      expect(core.formatClock(value)).toBe(reference.formatClock(value))
    for (const value of [1, 0, 2, '1', 1.0000001, null]) expect(core.dayWord(value)).toBe(reference.dayWord(value))
  })
})

// ---------------------------------------------------------------- the controller
function memoryStorage() {
  const values = new Map()
  return { values, getItem: k => values.has(k) ? values.get(k) : null, setItem: (k, v) => { values.set(k, String(v)) }, removeItem: k => values.delete(k) }
}
const SHELL = `<header class="header-actions"><button class="streak-chip" type="button" data-streak-chip data-state="idle" aria-label="Racha de lectura"></button></header>
<section id="reader-screen" hidden><div class="reader-heading"><button class="streak-chip" type="button" data-streak-chip data-state="idle" aria-label="Racha de lectura"></button></div>
<div id="reader-progress-fill"></div><span class="reader-location-label">1</span><div class="reading-mini-player"><button data-mini-play aria-label="Leer"></button></div></section>
<div data-widget-book-setting hidden><input type="checkbox" id="widget-book-toggle"></div>`

/** Flame gradients carry a running serial; number them by appearance so two runs compare. */
function stable(html) {
  const ids = new Map()
  return html.replace(/ihr-flame-(\d+)/g, (_, n) => { if (!ids.has(n)) ids.set(n, ids.size); return `ihr-flame-#${ids.get(n)}` })
}

async function session(create, seed) {
  const rng = random(seed)
  document.body.innerHTML = SHELL
  document.body.className = ''
  const storage = memoryStorage()
  const today = new Date(2026, 9, 23, pick(rng, [9, 23]), pick(rng, [0, 59]), 50)
  let clock = today.getTime()
  const key = reference.dayKey(today)
  const days = {}
  for (let i = 1; i <= Math.floor(rng() * 12); i++) if (rng() < 0.85) days[reference.addDays(key, -i)] = rng() < 0.8 ? 300 : 120
  days[key] = pick(rng, [0, 150, 292, 296.5, 300])
  const seeded = { v: 1, days, best: Math.floor(rng() * 6), celebrated: rng() < 0.2 ? key : '' }
  storage.setItem('inhouse-read-streak-device', JSON.stringify(seeded))
  if (rng() < 0.5) storage.setItem('inhouse-read-streak', JSON.stringify(reference.syncedStreak(reference.normalizeStreak({ ...seeded, days: { [reference.addDays(key, -20)]: 300 } }))))
  if (rng() < 0.3) storage.setItem('inhouse-read-widget-book', 'off')
  const log = []
  const reduced = rng() < 0.3
  globalThis.matchMedia = query => ({ matches: reduced && query.includes('reduced'), media: query })
  globalThis.InhouseStreak = {
    update: json => log.push(['update', json]),
    updateBook: json => log.push(['book', json]),
    canPin: () => true, isPlaced: () => false, requestPin: () => log.push(['pin'])
  }
  navigator.vibrate = pattern => { log.push(['vibrate', JSON.stringify(pattern)]); return true }
  const snapshot = label => log.push([label, stable(document.body.innerHTML), JSON.stringify([...storage.values]), document.activeElement?.outerHTML?.slice(0, 80) || ''])
  const records = [{ id: 'b1', title: '  Un libro  ', cover: { size: 12 } }, { id: 'b2', title: '', cover: null }]
  const streak = create({
    document, storage, now: () => clock,
    onChange: changed => log.push(['change', changed]),
    latestBook: async () => records[Math.floor(clock / 1000) % 2],
    bookTitle: record => record.title.trim()
  })
  const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve() }
  const step = async (ms, label) => { clock += ms; vi.advanceTimersByTime(ms); await flush(); if (label) snapshot(label) }
  snapshot('start')
  await step(4100, 'book')
  document.body.classList.add('is-reading')
  document.getElementById('reader-screen').hidden = false
  await flush()
  for (let i = 0; i < 14; i++) await step(1000, `tick ${i}`)
  await step(1500, 'celebrated')
  const calendar = document.querySelector('[data-streak-calendar]')
  if (calendar) { calendar.click(); await flush(); snapshot('calendar') }
  else { document.querySelector('.reader-heading [data-streak-chip]').click(); await flush(); snapshot('panel') }
  document.querySelector('[data-streak-month="-1"]').click(); snapshot('previous month')
  document.querySelector('[data-streak-month="1"]').click(); snapshot('next month')
  document.querySelector('[data-streak-widget]').click(); snapshot('pin')
  document.querySelector('.streak-panel').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await step(250, 'closed')
  document.getElementById('reader-progress-fill').textContent = 'page'
  await flush()
  await step(2000, 'page turned')
  await step(200_000, 'idle')
  window.dispatchEvent(new Event('pointerdown'))
  await step(1000, 'woken')
  storage.setItem('inhouse-read-streak', JSON.stringify({ v: 1, days: { [reference.addDays(key, -30)]: 300, [reference.addDays(key, -31)]: 300 }, best: 9, celebrated: '' }))
  streak.reconcile(); await flush(); snapshot('reconciled')
  log.push(['info', JSON.stringify(streak.info)])
  document.body.classList.remove('is-reading')
  await flush(); await step(10, 'closed reader')
  // Past midnight with the app open: the counter goes grey when it should.
  const midnight = new Date(clock); midnight.setHours(24, 0, 1, 0)
  await step(midnight.getTime() - clock, 'next day')
  document.getElementById('widget-book-toggle').click(); await flush(); await step(10, 'toggled')
  streak.destroy()
  await step(5000, 'destroyed')
  return log
}

describe('reading streak controller', () => {
  afterEach(() => { vi.useRealTimers(); delete globalThis.InhouseStreak; delete globalThis.matchMedia })
  it('renders, counts, celebrates and syncs exactly like the original', async () => {
    const seen = { celebration: 0, update: 0, book: 0, change: 0, vibrate: 0, lit: 0 }
    for (let seed = 1; seed <= 10; seed++) {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame'] })
      const theirs = await session(createReferenceStreak, seed)
      vi.useRealTimers()
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame'] })
      const ours = await session(createReadingStreak, seed)
      vi.useRealTimers()
      expect(ours.length).toBe(theirs.length)
      for (let i = 0; i < theirs.length; i++) expect(ours[i], `seed ${seed} entry ${i} (${theirs[i][0]})`).toEqual(theirs[i])
      for (const entry of ours) {
        if (entry[0] in seen) seen[entry[0]]++
        if (String(entry[1]).includes('streak-roll-new')) seen.celebration++
        if (String(entry[1]).includes('data-state="lit"')) seen.lit++
      }
    }
    // The sessions reach every part of the controller.
    for (const [name, count] of Object.entries(seen)) expect(count, name).toBeGreaterThan(0)
  })
})
