// The prepared page as the application's flows use it (rust-ui/src/prepared_page.rs and stage_gate.rs),
// behind the shapes the frozen JavaScript had: the cache is a plain record the page holds, a gate a plain
// record too, and `prepared_page` runs one operation on either.
export function nativePreparedPage(module) {
  const createPreparedPageCache = () => {
    const record = module.prepared_page('new'), run = (name, ...args) => module.prepared_page(name, record, ...args)
    return {
      record,
      begin:book => run('begin', book), isCurrent:ticket => run('isCurrent', ticket),
      store:(ticket, key, snapshot) => run('store', ticket, key, snapshot), take:key => run('take', key),
      has:book => run('has', book), peek:() => run('peek'),
      invalidate(reason = 'invalidated') { run('invalidate', reason) },
      invalidateBook(book, reason = 'book-changed') { run('invalidateBook', book, reason) },
      get lastDiscard() { return record.lastDiscard }
    }
  }
  const createStageGate = (settled, { idle = () => new Promise(resolve => setTimeout(resolve, 0)) } = {}) => {
    const gate = module.prepared_page('gate', settled, idle)
    return { wait:() => module.prepared_page('wait', gate), release:reason => module.prepared_page('release', gate, reason) }
  }
  const pageKeyMismatch = (prepared, wanted, { allowViewportTranslation = false } = {}) =>
    module.prepared_page('mismatch', prepared, wanted, !!allowViewportTranslation)
  return { createPreparedPageCache, createStageGate, pageKeyMismatch }
}
