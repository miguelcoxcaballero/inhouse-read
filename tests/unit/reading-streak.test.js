import { describe, expect, it } from 'vitest'
import {
  GOAL_SECONDS, addDays, addReading, dayKey, emptyStreak, formatClock, mergeStreaks, monthGrid,
  normalizeStreak, parseStreak, pruneStreak, streakInfo, syncedStreak, weekDays
} from '../../src/js/reading-streak-core.js'

const TODAY = '2026-10-23' // viernes
const withDays = (...entries) => ({ ...emptyStreak(), days: Object.fromEntries(entries) })
const run = (end, length, seconds = GOAL_SECONDS) => Array.from({ length }, (_, i) => [addDays(end, -i), seconds])

describe('días locales', () => {
  it('usa la fecha local y cruza meses y años', () => {
    expect(dayKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })
  it('no se desplaza con el cambio de hora', () => {
    // Octubre y marzo tienen días de 25 y 23 horas en Europa.
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26')
    expect(addDays('2026-03-29', -1)).toBe('2026-03-28')
  })
})

describe('racha', () => {
  it('cuenta hasta hoy si hoy está cumplido', () => {
    const info = streakInfo(withDays(...run(TODAY, 4)), TODAY)
    expect(info).toMatchObject({ current: 4, doneToday: true, atRisk: false, remaining: 0 })
  })
  it('mantiene la de ayer mientras hoy falta por leer, y avisa', () => {
    const info = streakInfo(withDays(...run(addDays(TODAY, -1), 3), [TODAY, 120]), TODAY)
    expect(info).toMatchObject({ current: 3, doneToday: false, atRisk: true, seconds: 120, remaining: 180 })
  })
  it('se rompe si falta un día entero', () => {
    const info = streakInfo(withDays(...run(addDays(TODAY, -2), 5)), TODAY)
    expect(info).toMatchObject({ current: 0, atRisk: false, best: 5, total: 5 })
  })
  it('un día con menos de 5 minutos no cuenta', () => {
    const state = withDays([TODAY, GOAL_SECONDS - 1], [addDays(TODAY, -1), GOAL_SECONDS])
    expect(streakInfo(state, TODAY).current).toBe(1)
    expect(streakInfo(state, TODAY).doneToday).toBe(false)
  })
})

describe('lectura', () => {
  it('avisa una sola vez al cruzar el objetivo', () => {
    let state = withDays(...run(addDays(TODAY, -1), 2), [TODAY, 290])
    const first = addReading(state, 9, TODAY)
    expect(first.reached).toBe(false)
    const second = addReading(first.state, 2, TODAY)
    expect(second.reached).toBe(true)
    expect(streakInfo(second.state, TODAY).current).toBe(3)
    expect(second.state.best).toBe(3)
    expect(addReading(second.state, 30, TODAY).reached).toBe(false)
  })
  it('no modifica el estado anterior', () => {
    const state = withDays([TODAY, 10])
    addReading(state, 50, TODAY)
    expect(state.days[TODAY]).toBe(10)
  })
})

describe('sincronización entre dispositivos', () => {
  it('une los días con el máximo de cada uno y es idempotente', () => {
    const phone = withDays(['2026-10-20', 300], ['2026-10-21', 100])
    const tablet = { ...withDays(['2026-10-21', 320], ['2026-10-22', 300]), celebrated: '2026-10-22' }
    const merged = mergeStreaks(phone, tablet)
    expect(merged.days).toEqual({ '2026-10-20': 300, '2026-10-21': 320, '2026-10-22': 300 })
    expect(merged.celebrated).toBe('2026-10-22')
    expect(merged.best).toBe(3)
    expect(mergeStreaks(merged, phone, tablet)).toEqual(merged)
    expect(mergeStreaks(tablet, phone)).toEqual(merged)
  })
  it('solo sincroniza los días cumplidos', () => {
    const state = { ...withDays(['2026-10-21', 900], [TODAY, 120]), best: 4, celebrated: '2026-10-21' }
    expect(syncedStreak(state)).toEqual({ v: 1, days: { '2026-10-21': GOAL_SECONDS }, best: 4, celebrated: '2026-10-21' })
  })
  it('ignora datos guardados corruptos o ajenos', () => {
    expect(parseStreak('{nope')).toEqual(emptyStreak())
    expect(normalizeStreak({ days: { 'x': 400, '2026-10-01': -4, '2026-10-02': '350', '2026-10-03': 1e9 }, best: 'many', celebrated: 7 }))
      .toEqual({ v: 1, days: { '2026-10-02': 350, '2026-10-03': 86400 }, best: 0, celebrated: '' })
  })
  it('borra lo muy antiguo sin perder la mejor racha', () => {
    const old = withDays(...run('2024-06-30', 20))
    const pruned = pruneStreak(old, TODAY)
    expect(pruned.days).toEqual({})
    expect(pruned.best).toBe(20)
  })
})

describe('calendarios', () => {
  it('la semana empieza en lunes y marca hoy y el futuro', () => {
    const week = weekDays(withDays(...run(TODAY, 3)), TODAY)
    expect(week.map(day => day.key)).toEqual(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'])
    expect(week.map(day => day.done)).toEqual([false, false, true, true, true, false, false])
    expect(week.filter(day => day.today).map(day => day.key)).toEqual([TODAY])
    expect(week.filter(day => day.future)).toHaveLength(2)
  })
  it('el mes deja huecos hasta el lunes y une los días seguidos', () => {
    const cells = monthGrid(withDays(...run('2026-10-07', 4), ['2026-10-09', 300]), 2026, 9, TODAY)
    expect(cells.slice(0, 3)).toEqual([null, null, null]) // 1 de octubre de 2026 es jueves
    const day = n => cells.find(cell => cell?.day === n)
    expect(day(4)).toMatchObject({ done: true, joinPrev: false, joinNext: true })
    expect(day(7)).toMatchObject({ done: true, joinPrev: true, joinNext: false })
    expect(day(9)).toMatchObject({ done: true, joinPrev: false, joinNext: false })
    expect(day(23).today).toBe(true)
    expect(day(24).future).toBe(true)
    expect(cells.filter(Boolean)).toHaveLength(31)
  })
  it('formatea el tiempo restante', () => {
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(9.4)).toBe('0:09')
    expect(formatClock(300)).toBe('5:00')
  })
})
