// Dictionaries from the same piper-tts-web 1.1.2/espeak-ng build as the shipped phonemizer.
// Unlike its in-memory filesystem, Cache Storage survives a cold worker and offline reading.
// The exact lengths and checksums below are checked against public/neural-voice/phon/dict in unit tests.
export const DICTIONARY_CACHE_NAME = 'inhouse-neural-dictionaries-v1'
export const PACKAGED_DICTIONARIES = Object.freeze(['ca', 'cs', 'da', 'de', 'en', 'es', 'fi', 'fr', 'hu', 'it', 'nl', 'pl', 'pt', 'ro', 'sv', 'tr'])

const descriptors = [
  { name: 'ar', bytes: 478165, sha256: '72316426e797777fe4df9420935a3b6a79b37d7e3f3948537ba71cd7b21b2541' },
  { name: 'bg', bytes: 87051, sha256: '8fa3adec8e18a3e695b2bbea1d4780182e17222d8b9f8da9908a237828f6b063' },
  { name: 'cmn', bytes: 1566335, sha256: '109aaa7708d3727382acb3ae41d8e2094a7e2bb9f651a81835be22a6f08071fe' },
  { name: 'el', bytes: 72841, sha256: '5d9f759750131da777d2fd4f06aa602ed746d38f27b84dd9a2d4a550f2cd452e' },
  { name: 'hi', bytes: 92143, sha256: '5a68c9532624e57ac845b26ce1e2e5034c4f6353bede46ecbe57e583ec8effd6' },
  { name: 'no', bytes: 4178, sha256: '43b828f8c1709e7abb23a0cc6416fb32e4814e3f1ff1db4baf2935bf7c77c9ff' },
  { name: 'ru', bytes: 8532392, sha256: 'f0f6181bbbf9e53cd1e8f9d26bde8fc62119c4f78181948f961cb29866e5e585' },
  { name: 'sr', bytes: 46832, sha256: '770cae9c516e48af7896629faf4abefaf041e1fd4ae184011aad07b97196f613' },
  { name: 'uk', bytes: 3492, sha256: 'a779bb0f51ce5cebb650a4e2282162fc8c44609210a2baa700f81f3e83e6e10c' },
  { name: 'vi', bytes: 52608, sha256: '64ff5187eb58f8033ebc326df0c2ebce5b65cc1db895656b5fc198762764dceb' }
]
const BY_NAME = new Map(descriptors.map(descriptor => [descriptor.name, Object.freeze(descriptor)]))
const ALIASES = { nb: 'no', nn: 'no', zh: 'cmn' }
const resourceError = (code, message, cause) => Object.assign(new Error(message), { code }, cause ? { cause } : {})
const aborted = () => resourceError('aborted', 'Dictionary download aborted')
const checkAbort = signal => { if (signal?.aborted) throw aborted() }

/** null for an embedded/unknown language; the config's actual espeak voice determines its dictionary. */
export function dictionaryNeeded(espeakVoice) {
  const base = String(espeakVoice || '').toLowerCase().split(/[-_]/)[0]
  return BY_NAME.get(ALIASES[base] || base) || null
}

export const dictionaryUrl = (base, name) => `${base}dict/${name}_dict`

function descriptorOf(url) {
  let parsed
  try { parsed = new URL(url, globalThis.location?.href) } catch (error) { throw resourceError('http', 'Invalid dictionary URL', error) }
  const name = /^([a-z]+)_dict$/.exec(parsed.pathname.slice(parsed.pathname.lastIndexOf('/') + 1))?.[1]
  const descriptor = BY_NAME.get(name)
  if (!descriptor) throw resourceError('http', `No verified dictionary descriptor for ${parsed.pathname}`)
  return { descriptor, key: parsed.href }
}

/** Reject promptly even when a cache/fetch double ignores its AbortSignal. */
function abortable(promise, signal, cancel = () => {}) {
  if (!signal) return promise
  if (signal.aborted) {
    Promise.resolve(promise).catch(() => {})
    try { cancel() } catch { /* cancellation is best effort */ }
    return Promise.reject(aborted())
  }
  let listener
  const interruption = new Promise((resolve, reject) => {
    listener = () => { try { cancel() } catch { /* cancellation is best effort */ } reject(aborted()) }
    signal.addEventListener('abort', listener, { once: true })
  })
  return Promise.race([promise, interruption]).finally(() => signal.removeEventListener('abort', listener))
}

async function validate(bytes, descriptor, signal) {
  checkAbort(signal)
  if (bytes.byteLength !== descriptor.bytes) throw resourceError('http', `Dictionary ${descriptor.name}: ${bytes.byteLength} bytes instead of ${descriptor.bytes}`)
  if (!globalThis.crypto?.subtle) throw resourceError('http', 'Dictionary checksum verification is unavailable')
  const digest = await abortable(globalThis.crypto.subtle.digest('SHA-256', bytes), signal)
  checkAbort(signal)
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  if (hash !== descriptor.sha256) throw resourceError('http', `Dictionary ${descriptor.name}: SHA-256 mismatch`)
}

const responseOf = bytes => new Response(bytes, { headers: { 'content-type': 'application/octet-stream', 'content-length': String(bytes.byteLength) } })

async function readNetwork(response, descriptor, signal, onProgress) {
  const reader = response.body?.getReader?.()
  if (!reader) {
    const bytes = await abortable(response.arrayBuffer(), signal)
    await validate(bytes, descriptor, signal)
    onProgress({ received: bytes.byteLength, total: descriptor.bytes, fraction: 1 })
    return bytes
  }
  const parts = []
  let received = 0, complete = false
  try {
    for (;;) {
      checkAbort(signal)
      const { done, value } = await abortable(reader.read(), signal, () => { reader.cancel().catch(() => {}) })
      if (done) break
      parts.push(value); received += value.byteLength
      if (received > descriptor.bytes) throw resourceError('http', `Dictionary ${descriptor.name}: response exceeds expected size`)
      onProgress({ received, total: descriptor.bytes, fraction: received / descriptor.bytes })
    }
    const bytes = new Uint8Array(received)
    let offset = 0
    for (const part of parts) { bytes.set(part, offset); offset += part.byteLength }
    await validate(bytes.buffer, descriptor, signal)
    complete = true
    return bytes.buffer
  } finally {
    if (!complete) { try { reader.cancel().catch(() => {}) } catch { /* failed or already cancelled */ } }
    try { reader.releaseLock?.() } catch { /* a cancelled read can still be settling */ }
  }
}

/**
 * Returns a fresh verified Response. Install and playback use this SAME URL/cache, so a downloaded voice's first
 * sentence can be spoken offline even when its language has never been loaded into an Emscripten filesystem.
 */
export async function fetchDictionary(url, { caches = globalThis.caches, fetch = globalThis.fetch, signal, onProgress = () => {} } = {}) {
  checkAbort(signal)
  const { descriptor, key } = descriptorOf(url)
  if (!caches?.open) throw resourceError('storage', 'Dictionary Cache Storage is unavailable')
  let cache
  try { cache = await abortable(caches.open(DICTIONARY_CACHE_NAME), signal) } catch (error) {
    if (error?.code === 'aborted') throw error
    throw resourceError('storage', 'Cannot open dictionary cache', error)
  }
  onProgress({ received: 0, total: descriptor.bytes, fraction: 0 })
  let stored
  try { stored = await abortable(cache.match(key), signal) } catch (error) {
    if (error?.code === 'aborted') throw error
    throw resourceError('storage', 'Cannot read dictionary cache', error)
  }
  if (stored) {
    let bytes
    try {
      if (!stored.ok) throw resourceError('http', `Dictionary ${descriptor.name}: cached HTTP ${stored.status}`)
      bytes = await abortable(stored.arrayBuffer(), signal)
      await validate(bytes, descriptor, signal)
    } catch (error) {
      if (error?.code === 'aborted') throw error
      await abortable(cache.delete(key).catch(() => {}), signal)
      throw error?.code ? error : resourceError('http', `Dictionary ${descriptor.name}: corrupt cached response`, error)
    }
    onProgress({ received: bytes.byteLength, total: descriptor.bytes, fraction: 1 })
    return responseOf(bytes)
  }
  checkAbort(signal)
  let response
  try {
    if (typeof fetch !== 'function') throw new Error('Fetch is unavailable')
    response = await abortable(fetch(key, { signal }), signal)
  } catch (error) {
    if (error?.name === 'AbortError' || error?.code === 'aborted' || signal?.aborted) throw aborted()
    throw resourceError('offline', `Dictionary ${descriptor.name}: network unavailable`, error)
  }
  if (!response?.ok) throw resourceError('http', `Dictionary ${descriptor.name}: HTTP ${response?.status ?? 'no response'}`)
  let bytes
  try { bytes = await readNetwork(response, descriptor, signal, onProgress) } catch (error) {
    if (error?.name === 'AbortError' || error?.code === 'aborted' || signal?.aborted) throw aborted()
    throw error?.code ? error : resourceError('http', `Dictionary ${descriptor.name}: interrupted response`, error)
  }
  checkAbort(signal)
  try { await abortable(cache.put(key, responseOf(bytes)), signal) } catch (error) {
    if (error?.code === 'aborted') throw error
    throw resourceError('storage', 'Cannot save dictionary for offline reading', error)
  }
  checkAbort(signal)
  onProgress({ received: bytes.byteLength, total: descriptor.bytes, fraction: 1 })
  return responseOf(bytes)
}
