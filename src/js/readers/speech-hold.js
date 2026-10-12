// The same hold gesture in the EPUB iframe and PDF text layer. Short taps
// always retain their page/chrome action, including while narration plays.
export function speechHold(doc) {
  const dispatch = (event, probe) => {
    const detail = { doc, x:event.clientX, y:event.clientY, probe, handled:false }
    window.dispatchEvent(new CustomEvent('inhouse-speech-hold', { detail }))
    return detail.handled
  }
  return { canLongPress:event => dispatch(event, true), onLongPress:event => dispatch(event, false) }
}
