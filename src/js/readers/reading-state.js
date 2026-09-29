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
export function cleanQuotes(value, limit = 200) {
  return (Array.isArray(value) ? value : []).filter(x => x && typeof x.text === 'string' && x.text.trim())
    .slice(0,limit).map((x,index) => ({
      id:String(x.id || `${Number(x.createdAt)||0}-${index}`).slice(0,80),
      text:x.text.trim().slice(0,1200), fraction:Math.min(1,Math.max(0,Number(x.fraction)||0)),
      locator:x.locator?.kind === 'pdf-page' ? {kind:'pdf-page',value:Math.max(1,Math.round(Number(x.locator.value)||1))}
        : x.locator?.kind === 'cfi' && typeof x.locator.value === 'string' ? {kind:'cfi',value:x.locator.value.slice(0,4096)} : null,
      label:String(x.label || '').slice(0,140), color:['yellow','green','blue','pink'].includes(x.color) ? x.color : 'yellow',
      createdAt:Number(x.createdAt)||0
    }))
}
