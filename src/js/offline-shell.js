/** Registration is background work: no import, opening or closing waits for it.
 * The worker promotes complete updates without reloading the open reader. */
export async function registerOfflineShell({navigator:nav=globalThis.navigator, base=import.meta.env.BASE_URL,
  location=globalThis.location, production=import.meta.env.PROD}={}) {
  if (!production || !nav?.serviceWorker || !location || !/^https?:$/.test(location.protocol)) return null
  const url = new URL(base, location.href)
  const registration = await nav.serviceWorker.register(new URL('sw.js', url).href,
    {scope:url.pathname, updateViaCache:'none'})
  return registration
}
