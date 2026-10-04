/** Coalesce background notifications without overlapping library reads.
 * Requests arriving during a read own a trailing batch, so they never inherit
 * a snapshot captured before their change. Immediate callers flush that batch.
 */
export function createShelfRefreshQueue({ perform, delay = 80,
  setTimer = (callback, ms) => setTimeout(callback, ms), clearTimer = id => clearTimeout(id) } = {}) {
  if (typeof perform !== 'function') throw new TypeError('Shelf refresh needs a perform callback');
  let timer = null, running = false, disposed = false, ready = false, immediate = false, pending = [];

  function finish(batch, result, error, failed = false) {
    running = false;
    for (const waiter of batch) failed ? waiter.reject(error) : waiter.resolve(result);
    start();
  }

  function start() {
    if (disposed || running || !ready || !pending.length) return;
    const batch = pending, options = { immediate };
    pending = []; ready = false; immediate = false; running = true;
    Promise.resolve().then(() => disposed ? undefined : perform(options)).then(
      result => finish(batch, result), error => finish(batch, undefined, error, true));
  }

  return {
    request({ immediate: urgent = false } = {}) {
      if (disposed) return Promise.resolve();
      const promise = new Promise((resolve, reject) => pending.push({ resolve, reject }));
      // Notifications such as CloudSync.onChange need not await this promise.
      // Callers which do await it still receive the original read failure.
      promise.catch(() => {});
      if (urgent) {
        immediate = true; ready = true;
        if (timer !== null) clearTimer(timer);
        timer = null;
      } else if (!ready && timer === null) {
        timer = setTimer(() => { timer = null; ready = true; start(); }, delay);
      }
      start();
      return promise;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (timer !== null) clearTimer(timer);
      timer = null; ready = false; immediate = false;
      for (const waiter of pending) waiter.resolve();
      pending = [];
      // An already running read retains its promise/error result. The app's
      // existing disposed guards prevent it from rendering a departing page.
    }
  };
}
