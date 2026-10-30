// Racha de lectura: datos puros (sin DOM). The records, their merge, the streak and the calendar
// cells are rust-ui/src/reading_streak.rs (shelf module, ready before the first shelf frame); these
// are the same exports as thin calls, kept for callers and tests. A day counts once GOAL_SECONDS
// were read in it; two devices merge by taking each day's maximum.
import { needRustShelf } from './rust-shelf.js'

export const GOAL_SECONDS = 300
export const STREAK_KEY = 'inhouse-read-streak'
export const STREAK_LOCAL_KEY = 'inhouse-read-streak-device'

const rust = () => needRustShelf()
export const dayKey = (date = new Date()) => rust().streak_day_key(date)
export const parseDay = key => rust().streak_parse_day(key)
export const addDays = (key, delta) => rust().streak_add_days(key, delta)
export const emptyStreak = () => ({ v: 1, days: {}, best: 0, celebrated: '' })
/** Acepta cualquier valor guardado y devuelve un estado válido. */
export const normalizeStreak = value => rust().streak_normalize(value)
export const parseStreak = text => rust().streak_parse(text)
export const mergeStreaks = (...states) => rust().streak_merge(states)
/** Quita días antiguos sin perder la mejor racha conocida. */
export const pruneStreak = (state, today = dayKey()) => ({ ...state, ...rust().streak_prune(state, today) })
/** Lo que se sincroniza: solo los días cumplidos, que cambian una vez al día. */
export const syncedStreak = state => ({ v: 1, days: rust().streak_synced_days(state), best: state.best, celebrated: state.celebrated })
export const isComplete = (state, key) => rust().streak_is_complete(state, key)
export const streakInfo = (state, today = dayKey()) => rust().streak_info(state, today)
/** Suma segundos leídos hoy. Devuelve el estado nuevo y si acaba de cumplirse el objetivo. */
export function addReading(state, seconds, today = dayKey()) {
  const [after, reached, best] = rust().streak_add_reading(state, seconds, today)
  const next = { ...state, days: { ...state.days, [today]: after } }
  if (reached) next.best = best
  return { state: next, reached: reached === 1 }
}
/** Lunes a domingo de la semana de `today`, con su estado. */
export const weekDays = (state, today = dayKey()) => rust().streak_week_days(state, today)
/** Celdas de un mes (empezando en lunes) con la forma de la racha para dibujar el calendario. */
export const monthGrid = (state, year, month, today = dayKey()) => rust().streak_month_grid(state, year, month, today)
export const formatClock = seconds => rust().streak_format_clock(+seconds)
export const dayWord = count => rust().streak_day_word(count)
