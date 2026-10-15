// A paginator can briefly report no anchor during layout or replacement.
// Such a notification must not erase the last location committed on device.
export function persistablePosition(location) {
  if (!location || !Number.isFinite(location.fraction)) return null
  const { locator } = location
  if (locator?.kind === 'cfi' && typeof locator.value === 'string' && locator.value.trim()) {
    return { fraction: Math.min(1, Math.max(0, location.fraction)), locator: { kind:'cfi', value:locator.value } }
  }
  if (locator?.kind === 'pdf-page' && Number.isInteger(locator.value) && locator.value > 0) {
    return { fraction: Math.min(1, Math.max(0, location.fraction)), locator: { kind:'pdf-page', value:locator.value,
      ...(Number.isInteger(locator.textOffset) && locator.textOffset > 0 ? { textOffset:locator.textOffset } : {}) } }
  }
  return null
}

export function persistableRelocation({ fraction, cfi, index, textOffset }, engine) {
  const locator = typeof cfi === 'string' && cfi.trim() ? { kind:'cfi', value:cfi }
    : engine === 'pdf' && Number.isInteger(index) && index >= 0 ? { kind:'pdf-page', value:index + 1, textOffset } : null
  return persistablePosition({ fraction, locator })
}
