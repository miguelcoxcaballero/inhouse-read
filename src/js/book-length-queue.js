import { completeWordCount, hasCompleteWordCount } from './book-length.js';
import { measureFileBookLength } from './file-book-length.js';

export const newContentRevision = () => globalThis.crypto?.randomUUID?.()
  || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
export const clearBookLength = () => ({ wordCount:null, wordCountVersion:null,
  wordCountComplete:false, wordCountContentRevision:null, lengthSource:null, estimatedPageCount:null });

export function isBookLengthReady(book) {
  return hasCompleteWordCount(book) && (!book.content || Boolean(book.contentRevision)
    && book.wordCountContentRevision === book.contentRevision);
}

/** One detached parser at a time. Navigation/closing does not cancel it;
 * replacing/removing bytes does. Successful counts commit atomically with the
 * captured content revision, so a late job cannot measure a different import. */
export function createBookLengthQueue(library, { measureFile = measureFileBookLength,
  onChange = () => {}, onError = () => {} } = {}) {
  const entries = new Map();
  let tail = Promise.resolve(), disposed = false;
  const geometryState = book => {
    if (isBookLengthReady(book)) return 'ready';
    const entry = entries.get(book?.id);
    return entry?.revision === book?.contentRevision && entry?.status === 'failed'
      ? 'failed' : book?.content ? 'pending' : 'needs-source';
  };
  async function ensure(bookOrId) {
    if (disposed) return null;
    const id = typeof bookOrId === 'string' ? bookOrId : bookOrId?.id;
    let record = typeof bookOrId === 'object' ? bookOrId : id && await library.get(id);
    if (!record || disposed || isBookLengthReady(record) || !record.content) return record || null;
    if (!record.contentRevision) {
      const revision = newContentRevision();
      record = await library.patch(id, { contentRevision:revision }, {
        ifCurrent:current => Boolean(current.content) && !current.contentRevision
      }) || await library.get(id);
      if (!record?.content || disposed) return null;
      if (isBookLengthReady(record)) return record;
    }
    const previous = entries.get(id);
    if (previous?.revision === record.contentRevision) return previous.task;
    if (previous) previous.cancelled = true;
    const entry = { revision:record.contentRevision, status:'pending', cancelled:false, task:null };
    const active = () => !disposed && !entry.cancelled && entries.get(id) === entry;
    entry.task = tail.catch(() => {}).then(async () => {
      if (!active()) return null;
      const latest = await library.get(id);
      if (!latest || latest.contentRevision !== entry.revision || !latest.content) return null;
      const file = new File([latest.content], latest.name || latest.title || 'libro',
        { type:latest.mimeType || latest.content.type || '' });
      let length;
      try { length = await measureFile(file, { isActive:active }); }
      catch (error) { if (active()) onError(error, latest); }
      if (!active()) return null;
      length = hasCompleteWordCount(length) ? completeWordCount(length.wordCount) : null;
      if (!length) {
        entry.status = 'failed'; onChange(null, { id, status:'failed' }); return null;
      }
      const saved = await library.patch(id, { ...length,
        wordCountContentRevision:entry.revision, lengthDirty:true }, {
        ifCurrent:current => active() && Boolean(current.content) && current.contentRevision === entry.revision
      });
      if (saved) { entry.status = 'ready'; onChange(saved, { id, status:'ready' }); }
      return saved;
    }).catch(error => {
      if (active()) { entry.status = 'failed'; onError(error, record); onChange(null, { id, status:'failed' }); }
      return null;
    });
    entries.set(id, entry);
    tail = entry.task.catch(() => {});
    return entry.task;
  }
  return {
    ensure, geometryState,
    cancel(id) { const entry = entries.get(id); if (entry) entry.cancelled = true; entries.delete(id); },
    retry(bookOrId) { const id = typeof bookOrId === 'string' ? bookOrId : bookOrId?.id;
      this.cancel(id); const task = ensure(bookOrId); onChange(null, { id, status:'pending' }); return task; },
    dispose() { disposed = true; for (const entry of entries.values()) entry.cancelled = true; entries.clear(); }
  };
}
