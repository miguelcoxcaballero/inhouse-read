export const SYNC_SETTINGS = ['inhouse-read-shelf-plants', 'inhouse-read-shelf-lamps', 'inhouse-read-shelf-physics-v1',
  'inhouse-read-shelf-type', 'inhouse-read-shelf-view', 'inhouse-read-theme', 'inhouse-read-reading-preferences']
const parse = (storage, key, fallback) => { try { return JSON.parse(storage.getItem(key)) ?? fallback } catch { return fallback } }
const CHANGES_KEY = 'inhouse-read-backup-settings-changes'
export function notifyCloudSettingsChanged(key) {
  if (!SYNC_SETTINGS.includes(key)) return
  const stamps = parse(localStorage, CHANGES_KEY, {})
  stamps[key] = Math.max(Date.now(), (Number(stamps[key]) || 0) + 1)
  localStorage.setItem(CHANGES_KEY, JSON.stringify(stamps))
  globalThis.dispatchEvent(new Event('inhouse-library-changed'))
}
