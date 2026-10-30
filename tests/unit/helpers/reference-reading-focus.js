// Frozen copy of src/js/reading-focus.js before the switch moved to rust-ui/src/reading_focus.rs; the
// differential test tests/unit/reading-focus-rust.test.js runs both on the same scripted bridges.
// «Sin avisos al leer» (solo en la app Android): con un libro abierto, un modo No
// molestar de la app oculta las notificaciones emergentes. Android pide una vez
// el permiso de «No molestar»; la app lo enciende y apaga sola con el lector.

const bridgeOf = view => {
  const bridge = view?.InhouseReadingFocus
  return bridge && typeof bridge.state === 'function' ? bridge : null
}

function readState(bridge) {
  try { return JSON.parse(bridge.state()) || {} } catch { return {} }
}

/** Enlaza el interruptor de Ajustes. Devuelve una función que lo desmonta. */
export function bindReadingFocus(document, view = document.defaultView) {
  const bridge = bridgeOf(view)
  const toggle = document.getElementById('reading-focus-toggle')
  const row = toggle?.closest('[data-reading-focus-setting]')
  const hint = document.getElementById('reading-focus-hint')
  if (!bridge || !toggle || !row || !readState(bridge).supported) return () => {}
  row.hidden = false
  // Solo tras pedirlo aquí: si falta el permiso, se explica dónde darlo.
  let asked = false

  const render = () => {
    const state = readState(bridge)
    toggle.checked = !!(state.enabled && state.access)
    if (hint) hint.hidden = !(asked && state.enabled && !state.access)
  }
  const change = () => {
    try { bridge.setEnabled(toggle.checked) } catch {}
    const state = readState(bridge)
    if (toggle.checked && !state.access) {
      asked = true
      toggle.checked = false
      try { bridge.openAccess() } catch {}
    }
    render()
  }
  // Al volver del ajuste de Android el permiso puede haber cambiado.
  const visible = () => { if (document.visibilityState === 'visible') render() }
  toggle.addEventListener('change', change)
  document.addEventListener('visibilitychange', visible)
  view.addEventListener('focus', visible)
  render()
  return () => {
    toggle.removeEventListener('change', change)
    document.removeEventListener('visibilitychange', visible)
    view.removeEventListener('focus', visible)
  }
}
