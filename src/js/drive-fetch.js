// The browser owns cancellation. Keep the deadline active through response
// body reads; a fetch that never settles must not freeze live discovery forever.
export function driveFetch(url, {transfer = false, ...options} = {}) {
  // OAuth already supplies its own cancellable, bounded request.
  const signal = options.signal || AbortSignal.timeout(transfer || String(url).includes('/upload/') ? 300000 : 20000)
  return fetch(url, {...options, signal})
}
