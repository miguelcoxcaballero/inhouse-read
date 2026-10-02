// The page a book opens on, prepared while the book is still being lifted off
// the shelf. The expensive part of opening (restore the saved place, lay the
// page out, rasterise it) is done ahead of the tap and kept here, together with
// the conditions it was made under. A prepared page is only ever handed out
// when every one of those conditions still holds: showing a stale page (other
// size, other theme, a place that moved since) is worse than computing it now.

const EDGE_TOLERANCE = .5
const FRACTION_TOLERANCE = 1e-9

const sameJSON = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const sameNumber = (a, b, tolerance) => Math.abs((Number(a) || 0) - (Number(b) || 0)) <= tolerance

/**
 * The first condition that differs between the key a page was prepared under
 * and the key of the moment it is wanted, or null when the page is still valid.
 *
 * key = { bookId, epoch, locator, fraction, location, viewport:{left,top,width,height},
 *         pixelRatio, preferences, theme, filter }
 *  - epoch: which engine instance (a different book or a reopened one is a new epoch)
 *  - locator/fraction: the saved place the page was restored to (Drive progress can change it)
 *  - location: where the reader said it was once the page was laid out
 *  - viewport/pixelRatio: the geometry the page was rasterised for
 *  - preferences/theme/filter: reading preferences, app theme and the viewport's CSS filter
 */
export function pageKeyMismatch(prepared, wanted) {
  if (!prepared || !wanted) return 'missing'
  if (prepared.bookId !== wanted.bookId) return 'book'
  if (prepared.epoch !== wanted.epoch) return 'engine'
  if (!sameJSON(prepared.locator, wanted.locator) ||
      !sameNumber(prepared.fraction, wanted.fraction, FRACTION_TOLERANCE)) return 'saved-position'
  if (!sameJSON(prepared.location, wanted.location)) return 'reader-position'
  for (const edge of ['left', 'top', 'width', 'height']) {
    if (!sameNumber(prepared.viewport?.[edge], wanted.viewport?.[edge], EDGE_TOLERANCE)) return 'viewport'
  }
  if (prepared.pixelRatio !== wanted.pixelRatio) return 'pixel-ratio'
  if (prepared.preferences !== wanted.preferences) return 'preferences'
  if (prepared.theme !== wanted.theme) return 'theme'
  if (prepared.filter !== wanted.filter) return 'filter'
  return null
}

/**
 * One prepared page at a time (there is one shared reader). `begin()` hands out
 * a ticket before the work starts; any invalidation made while the work runs
 * makes `store()` refuse the result, so a slow snapshot can never outlive the
 * event that made it wrong.
 */
export function createPreparedPageCache() {
  let generation = 0
  let entry = null
  let lastBookId = null
  let lastDiscard = null
  const discard = reason => { if (entry) lastDiscard = reason; entry = null }
  return {
    begin(bookId) {
      generation++
      discard('new-work')
      lastBookId = bookId
      return { bookId, generation }
    },
    isCurrent: ticket => Boolean(ticket) && ticket.generation === generation,
    store(ticket, key, snapshot) {
      if (!ticket || ticket.generation !== generation || !snapshot || ticket.bookId !== key?.bookId) return false
      entry = { key, snapshot }
      return true
    },
    /** The prepared page when `key` still matches, consuming it; otherwise null (and the page is dropped). */
    take(key) {
      const held = entry
      entry = null
      if (!held) return null
      const mismatch = pageKeyMismatch(held.key, key)
      if (mismatch) { lastDiscard = mismatch; return null }
      return held.snapshot
    },
    has: bookId => entry?.key.bookId === bookId,
    peek: () => entry?.snapshot ?? null,
    /** Everything: the engine changed, the window resized, the reader closed... */
    invalidate(reason = 'invalidated') {
      generation++
      discard(reason)
    },
    /** Only when `bookId` owns the page (or the work in flight): deletion, a book's own change. */
    invalidateBook(bookId, reason = 'book-changed') {
      if (entry?.key.bookId === bookId || lastBookId === bookId) this.invalidate(reason)
    },
    get lastDiscard() { return lastDiscard }
  }
}

/**
 * Holds the heavy page work back until it can no longer disturb the pull-out
 * animation. `settled` resolves true once the lifted book sits still (false when
 * the selection was cancelled); the work then waits for an idle slice. An open
 * request (`release('open')`) lets it go at once, because somebody is waiting
 * for the result; any other release (the selection was dismissed or replaced)
 * ends the wait without work. `wait()` resolves true to proceed, false to skip.
 */
export function createStageGate(settled, { idle = () => new Promise(resolve => setTimeout(resolve, 0)) } = {}) {
  let release = () => {}
  const released = new Promise(resolve => { release = resolve })
  // No signal from the shelf (a book opened some other way): nothing to wait for.
  const settledThenIdle = settled == null ? Promise.resolve(true) : Promise.resolve(settled).then(async ok => {
    if (!ok) return false
    await idle()
    return true
  }, () => false)
  return {
    wait: () => Promise.race([released, settledThenIdle]),
    release: reason => release(reason === 'open')
  }
}
