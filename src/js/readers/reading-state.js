export const clonePlace = place => ({ fraction:place.fraction || 0, locator:place.locator ? { ...place.locator } : null })
export function cleanPlaces(value, limit = 20) {
  return (Array.isArray(value) ? value : []).filter(x => x && Number.isFinite(Number(x.fraction)))
    .slice(0, limit).map(x => ({
      fraction:Math.min(1, Math.max(0, Number(x.fraction))),
      locator:x.locator?.kind === 'pdf-page' ? { kind:'pdf-page', value:Math.max(1, Math.round(Number(x.locator.value) || 1)) }
        : x.locator?.kind === 'cfi' && typeof x.locator.value === 'string' ? { kind:'cfi', value:x.locator.value.slice(0,4096) } : null,
      label:String(x.label || '').slice(0,140), createdAt:Number(x.createdAt) || 0
    }))
}
