import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { GaplessPlayer, safeToStart } from '../../src/js/readers/neural-voice/player.js'
import { fakeAudioContext, advance } from './neural-fakes.js'

const pcm = seconds => new Float32Array(Math.round(seconds * 22050)).fill(0.1)

describe('GaplessPlayer', () => {
  let ctx, starts, ends, player
  beforeEach(() => {
    vi.useFakeTimers()
    ctx = fakeAudioContext()
    starts = []; ends = []
    player = new GaplessPlayer({ context: () => ctx, onStart: n => starts.push([n, ctx.currentTime]), onEnd: n => ends.push([n, ctx.currentTime]) })
  })
  afterEach(() => vi.useRealTimers())

  it('schedules chunks back to back on the audio clock, with no gap and no overlap', () => {
    const a = player.schedule(1, pcm(2), 22050)
    const b = player.schedule(1, pcm(1.5), 22050, { last: true })
    const c = player.schedule(2, pcm(1), 22050, { last: true })
    expect(a).toBeCloseTo(0.03, 5)                 // a small lead on an idle queue
    expect(b).toBeCloseTo(a + 2, 4)
    expect(c).toBeCloseTo(b + 1.5, 4)
    const times = ctx.sources.map(s => s.startedAt)
    expect(times).toEqual([a, b, c])
    expect(player.buffered()).toBeCloseTo(0.03 + 4.5, 2)
  })

  it('fires start when the first sample is audible and done when the last one has played', () => {
    player.schedule(1, pcm(1), 22050, { last: true })
    player.schedule(2, pcm(1), 22050, { last: true })
    advance(ctx, 0.02)
    expect(starts).toEqual([])                       // not before its time
    advance(ctx, 0.05)
    expect(starts.map(s => s[0])).toEqual([1])
    expect(starts[0][1]).toBeCloseTo(0.03, 1)
    expect(player.playing()).toBe(1)
    advance(ctx, 1)
    expect(ends.map(e => e[0])).toEqual([1])
    expect(starts.map(s => s[0])).toEqual([1, 2])    // fragment 2 starts as 1 ends
    advance(ctx, 1.1)
    expect(ends.map(e => e[0])).toEqual([1, 2])
    expect(player.playing()).toBe(null)
  })

  it('compensates the output latency: audible time, not render time', () => {
    ctx.outputLatency = 0.12
    player.schedule(1, pcm(1), 22050, { last: true })
    advance(ctx, 0.1)
    expect(starts).toEqual([])
    advance(ctx, 0.1)
    expect(starts.length).toBe(1)
    expect(starts[0][1]).toBeGreaterThanOrEqual(0.15 - 0.011)
  })

  it('does not end a unit that is still receiving chunks', () => {
    player.schedule(1, pcm(0.5), 22050)               // not last
    advance(ctx, 2)
    expect(ends).toEqual([])
    expect(player.drained()).toBe(true)               // the queue ran dry: whatever comes next is an underrun for the caller
    player.schedule(1, pcm(0.5), 22050, { last: true })
    advance(ctx, 1)
    expect(ends.map(e => e[0])).toEqual([1])
  })

  it('restarts an idle queue at "now" instead of in the past', () => {
    player.schedule(1, pcm(0.2), 22050, { last: true })
    advance(ctx, 5)
    const when = player.schedule(2, pcm(0.2), 22050, { last: true })
    expect(when).toBeCloseTo(ctx.currentTime + 0.03, 3)
  })

  it('drained() is false before anything was scheduled and while audio is queued', () => {
    expect(player.drained()).toBe(false)
    player.schedule(1, pcm(1), 22050, { last: true })
    expect(player.drained()).toBe(false)
    advance(ctx, 1.2)
    expect(player.drained()).toBe(true)
  })

  it('stopAll silences every source and fires nothing afterwards', () => {
    player.schedule(1, pcm(1), 22050, { last: true })
    player.schedule(2, pcm(1), 22050, { last: true })
    advance(ctx, 0.5)
    player.stopAll()
    expect(ctx.sources.every(s => s.stopped)).toBe(true)
    const startsBefore = starts.length
    advance(ctx, 5)
    expect(starts.length).toBe(startsBefore)
    expect(ends).toEqual([])
    expect(player.buffered()).toBe(0)
    expect(player.drained()).toBe(false)
    // a new run starts fresh
    expect(player.schedule(3, pcm(1), 22050, { last: true })).toBeCloseTo(ctx.currentTime + 0.03, 3)
  })

  it('truncateAfter drops the fragments after one and makes the queue end where it ends', () => {
    player.schedule(1, pcm(1), 22050, { last: true })
    player.schedule(2, pcm(1), 22050, { last: true })
    player.schedule(3, pcm(1), 22050, { last: true })
    player.truncateAfter(1)
    expect(ctx.sources.filter(s => s.stopped).length).toBe(2)
    const when = player.schedule(4, pcm(1), 22050, { last: true })
    expect(when).toBeCloseTo(0.03 + 1, 3)
    advance(ctx, 3)
    expect(ends.map(e => e[0])).toEqual([1, 4])
  })

  it('keeps waiting while the context is suspended (the audio clock decides, not the timer)', () => {
    player.schedule(1, pcm(1), 22050, { last: true })
    ctx.state = 'suspended'
    for (let i = 0; i < 100; i++) vi.advanceTimersByTime(10) // timers run but the audio clock does not move
    expect(starts).toEqual([])
    advance(ctx, 0.2)
    expect(starts.length).toBe(1)
  })

  it('throws a clear error without an AudioContext', () => {
    const none = new GaplessPlayer({ context: () => null })
    expect(() => none.schedule(1, pcm(1), 22050)).toThrow(/AudioContext/)
  })
})

describe('safeToStart', () => {
  it('starts at once when everything is in hand', () => {
    expect(safeToStart({ ready: [3], pending: [] })).toBe(true)
  })
  it('starts early when the rest will be computed faster than it is played', () => {
    expect(safeToStart({ ready: [2], pending: [4, 4], rtf: 0.45 })).toBe(true)  // 1.8 s for 4 s of speech, 2 s in hand
  })
  it('waits when a long sentence follows a short one and the machine is not fast enough', () => {
    expect(safeToStart({ ready: [1], pending: [12], rtf: 0.7 })).toBe(false)   // 8.4 s to compute, 1 s in hand
    expect(safeToStart({ ready: [1, 12], pending: [], rtf: 0.7 })).toBe(true)  // ... so it starts once the long one is in hand
  })
  it('accounts for the time of every pending chunk, not only the next one', () => {
    expect(safeToStart({ ready: [2], pending: [2, 2, 2, 2], rtf: 0.95, slack: 0.3 })).toBe(true)
    expect(safeToStart({ ready: [2], pending: [2, 2, 2, 2], rtf: 1.3, slack: 0.3 })).toBe(false)
  })
})
