// Keep the latest pending reading position, rather than building a backlog
// of obsolete IndexedDB writes. Settings are ordered barriers: a position
// can replace only the pending position immediately before it.
export function createReadingProgressQueue(library, { onSaved = () => {} } = {}) {
  const books = new Map()

  async function drain(id, entry) {
    while (entry.pending.length) {
      const task = entry.pending.shift()
      try {
        const record = task.kind === 'position'
          ? await library.updateProgress(id, task.fraction, task.locator)
          : await library.patch(id, { ...task.fields, progressUpdatedAt:Date.now(), progressDirty:true })
        await onSaved(record, id)
        task.resolve(record)
      } catch (error) {
        task.reject(error)
      }
    }
    if (books.get(id) === entry) books.delete(id)
  }

  function enqueue(id, update) {
    let entry = books.get(id)
    if (!entry) {
      entry = { pending:[], latest:null }
      books.set(id, entry)
      // Start in this task's microtask, without a timer or debounce delay.
      Promise.resolve().then(() => drain(id, entry))
    }
    const tail = entry.pending.at(-1)
    if (update.kind === 'position' && tail?.kind === 'position') {
      tail.fraction = update.fraction
      tail.locator = update.locator
      return tail.promise
    }
    const task = { ...update }
    task.promise = new Promise((resolve, reject) => { task.resolve = resolve; task.reject = reject })
    // The caller still receives a failed commit. A replaced pending position
    // can have no remaining observer; never leave its rejection unhandled.
    task.promise.catch(() => {})
    entry.pending.push(task)
    entry.latest = task.promise
    return task.promise
  }

  return {
    updateProgress: (id, fraction, locator) => enqueue(id, { kind:'position', fraction, locator }),
    patch: (id, fields) => enqueue(id, { kind:'settings', fields:{ ...fields } }),
    get: id => books.get(id)?.latest
  }
}
