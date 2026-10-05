// Call only after the initial canvas text construction/paint: measureText
// can initiate font loading even if the FontFaceSet was loaded beforehand.
// Unknown status retains the original readiness callback, including its errors.
export function refreshCanvasFontsAfterPaint(callback, fonts = globalThis.document?.fonts) {
  if (fonts?.status === 'loaded') return;
  return fonts?.ready.then(callback);
}
