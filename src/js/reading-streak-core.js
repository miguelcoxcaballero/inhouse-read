// Racha de lectura: datos puros (sin DOM). Un día cuenta cuando se leen
// GOAL_SECONDS en él; la racha son los días seguidos que cumplen el objetivo,
// contando hasta hoy o, si hoy aún no se ha cumplido, hasta ayer.
//
// Los segundos se guardan por día local (YYYY-MM-DD). Dos dispositivos se
// combinan tomando el máximo de cada día, así que la fusión es idempotente y
// no pierde lecturas aunque el ajuste sincronizado sea de último escritor.

export const GOAL_SECONDS = 300
export const STREAK_KEY = 'inhouse-read-streak'
export const STREAK_LOCAL_KEY = 'inhouse-read-streak-device'
const KEEP_DAYS = 420
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

const pad = value => String(value).padStart(2, '0')
export const dayKey = (date = new Date()) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
export function parseDay(key) {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year, month - 1, day, 12)
}
export function addDays(key, delta) {
  const date = parseDay(key)
  date.setDate(date.getDate() + delta)
  return dayKey(date)
}

export const emptyStreak = () => ({ v: 1, days: {}, best: 0, celebrated: '' })

/** Acepta cualquier valor guardado y devuelve un estado válido. */
export function normalizeStreak(value) {
  const state = emptyStreak()
  if (!value || typeof value !== 'object') return state
  if (value.days && typeof value.days === 'object') {
    for (const [key, seconds] of Object.entries(value.days)) {
      const amount = Math.floor(Number(seconds))
      if (DAY_RE.test(key) && amount > 0) state.days[key] = Math.min(amount, 86400)
    }
  }
  const best = Math.floor(Number(value.best))
  if (best > 0) state.best = best
  if (typeof value.celebrated === 'string' && DAY_RE.test(value.celebrated)) state.celebrated = value.celebrated
  return state
}

export function parseStreak(text) {
  try { return normalizeStreak(JSON.parse(text)) } catch { return emptyStreak() }
}

export function mergeStreaks(...states) {
  const merged = emptyStreak()
  for (const raw of states) {
    const state = normalizeStreak(raw)
    for (const [key, seconds] of Object.entries(state.days)) merged.days[key] = Math.max(merged.days[key] || 0, seconds)
    merged.best = Math.max(merged.best, state.best)
    if (state.celebrated > merged.celebrated) merged.celebrated = state.celebrated
  }
  merged.best = Math.max(merged.best, longestRun(merged))
  return merged
}

/** Quita días antiguos sin perder la mejor racha conocida. */
export function pruneStreak(state, today = dayKey()) {
  const limit = addDays(today, -KEEP_DAYS)
  const best = Math.max(state.best, longestRun(state))
  const days = {}
  for (const [key, seconds] of Object.entries(state.days)) if (key >= limit) days[key] = seconds
  return { ...state, days, best }
}

/** Lo que se sincroniza: solo los días cumplidos, que cambian una vez al día.
 *  El progreso de hoy se queda en el dispositivo y no dispara copias a Drive. */
export function syncedStreak(state) {
  const days = {}
  for (const [key, seconds] of Object.entries(state.days)) if (seconds >= GOAL_SECONDS) days[key] = GOAL_SECONDS
  return { v: 1, days, best: state.best, celebrated: state.celebrated }
}

export const isComplete = (state, key) => (state.days[key] || 0) >= GOAL_SECONDS

function longestRun(state) {
  const keys = Object.keys(state.days).filter(key => isComplete(state, key)).sort()
  let best = 0, run = 0, previous = ''
  for (const key of keys) {
    run = previous && addDays(previous, 1) === key ? run + 1 : 1
    best = Math.max(best, run)
    previous = key
  }
  return best
}

export function streakInfo(state, today = dayKey()) {
  const doneToday = isComplete(state, today)
  let cursor = doneToday ? today : addDays(today, -1)
  let current = 0
  while (isComplete(state, cursor)) { current++; cursor = addDays(cursor, -1) }
  const seconds = Math.min(state.days[today] || 0, GOAL_SECONDS)
  const total = Object.keys(state.days).filter(key => isComplete(state, key)).length
  return {
    current,
    doneToday,
    // Hay racha, pero hoy todavía no se ha leído lo suficiente para mantenerla.
    atRisk: !doneToday && current > 0,
    seconds,
    remaining: GOAL_SECONDS - seconds,
    best: Math.max(state.best, longestRun(state), current),
    total
  }
}

/** Suma segundos leídos hoy. Devuelve el estado nuevo y si acaba de cumplirse el objetivo. */
export function addReading(state, seconds, today = dayKey()) {
  const before = state.days[today] || 0
  const after = Math.min(before + seconds, 86400)
  const next = { ...state, days: { ...state.days, [today]: after } }
  const reached = before < GOAL_SECONDS && after >= GOAL_SECONDS
  if (reached) next.best = Math.max(next.best, streakInfo(next, today).current)
  return { state: next, reached }
}

/** Lunes a domingo de la semana de `today`, con su estado. */
export function weekDays(state, today = dayKey()) {
  const date = parseDay(today)
  const monday = addDays(today, -((date.getDay() + 6) % 7))
  return Array.from({ length: 7 }, (_, index) => {
    const key = addDays(monday, index)
    return { key, done: isComplete(state, key), today: key === today, future: key > today }
  })
}

/** Celdas de un mes (empezando en lunes) con la forma de la racha para dibujar el calendario. */
export function monthGrid(state, year, month, today = dayKey()) {
  const first = new Date(year, month, 1, 12)
  const lead = (first.getDay() + 6) % 7
  const length = new Date(year, month + 1, 0).getDate()
  const cells = []
  for (let i = 0; i < lead; i++) cells.push(null)
  for (let day = 1; day <= length; day++) {
    const key = `${year}-${pad(month + 1)}-${pad(day)}`
    const done = isComplete(state, key)
    cells.push({
      key, day, done,
      today: key === today,
      future: key > today,
      // Une los días seguidos de la racha con una banda, como en el calendario de la racha.
      joinPrev: done && isComplete(state, addDays(key, -1)),
      joinNext: done && isComplete(state, addDays(key, 1))
    })
  }
  return cells
}

export function formatClock(seconds) {
  const value = Math.max(0, Math.round(seconds))
  return `${Math.floor(value / 60)}:${pad(value % 60)}`
}

export const dayWord = count => count === 1 ? 'día' : 'días'
