const element = (tag, className, text) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}
function button(label, action, id, className = '', ariaLabel = '') {
  const node = element('button', `reading-neural-btn ${className}`.trim(), label)
  node.type = 'button'; node.dataset.neuralAction = action
  if (id) node.dataset.neuralId = id
  if (ariaLabel) node.setAttribute('aria-label', ariaLabel)
  return node
}
function progress(label, download, voice) {
  const wrap = element('div', 'reading-neural-progress')
  const bar = element('div', 'reading-neural-bar'), fill = element('i')
  bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-label', label)
  bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', '100'); bar.append(fill)
  wrap.append(bar, element('span', 'reading-neural-percent'))
  paintProgress(wrap, download, voice)
  return wrap
}
/** Sets the numbers of a progress block built by progress() without rebuilding it (a pressed button must stay in the DOM). */
function paintProgress(wrap, download, voice) {
  const percent = Math.max(0, Math.min(100, Math.round((download?.fraction || 0) * 100)))
  const total = download?.total > 0 ? download.total / 1e6 : voice.sizeMB
  wrap.querySelector('[role="progressbar"]').setAttribute('aria-valuenow', String(percent))
  wrap.querySelector('i').style.width = `${percent}%`
  wrap.querySelector('.reading-neural-percent').textContent = `${percent} %${total ? ` · ${Math.round(total * percent / 100)} de ${Math.round(total)} MB` : ''}`
}

export class LegacyNeuralView {
  constructor(panel) { this.panel=panel; this.block=panel.querySelector("[data-neural]"); this.offer=panel.querySelector("[data-neural-offer]") }
  paintProgress(...args) { return paintProgress(...args) }
  row(voice, state, selected, expansion, language, size, licenseURL) {
    const { name, download, message } = state
    const item = element('li', 'reading-neural-voice'); item.dataset.neuralVoice = voice.id; item.dataset.state = name
    const text = element('div', 'reading-neural-voice__text'), title = element('span', 'reading-neural-voice__name', voice.name)
    if (voice.recommended) title.append(' ', element('small', 'reading-neural-voice__badge', 'Recomendada'))
    const detail = [language, name === 'installed' ? 'Instalada' : `${size} MB${expansion?' adicionales':''}`]
    if (voice.sharedPack) detail.push('Paquete compartido · todos sus idiomas y voces')
    text.append(title, element('span', 'reading-neural-voice__meta', detail.join(' · ')))
    if (voice.licenseUrl) {
      const license = element('a', 'reading-neural-voice__license', `Licencia ${voice.licenseName || 'OpenRAIL-M'}`)
      license.href = licenseURL
      license.target = '_blank'; license.rel = 'noopener noreferrer'
      text.append(license)
    }
    const actions = element('div', 'reading-neural-voice__actions')
    const where = `${voice.name}, ${language}`
    if (name === 'idle') actions.append(button(expansion?'Ampliar voces':'Descargar', 'install', voice.id, '', `${expansion?'Ampliar con':'Descargar'} la voz ${where} (${size} MB)`))
    else if (name === 'downloading') actions.append(button('Cancelar', 'cancel', voice.id, '', `Cancelar la descarga de ${voice.name}`))
    else if (name === 'error') actions.append(button('Reintentar', 'install', voice.id, '', `Reintentar la descarga de ${voice.name}`))
    else {
      const use = button(selected ? 'En uso' : 'Usar', 'use', voice.id, selected ? 'is-selected' : '', `${selected ? 'Voz en uso' : 'Usar la voz'} ${where}`)
      use.setAttribute('aria-pressed', String(selected))
      actions.append(use, button('Quitar', 'remove', voice.id, 'is-quiet', voice.sharedPack ? `Quitar el paquete compartido Supertonic del dispositivo` : `Quitar la voz ${where} del dispositivo`))
    }
    item.append(text, actions)
    if (name === 'downloading') item.append(progress(`Descargando ${voice.name}`, download, voice))
    if (name === 'error') { const note = element('p', 'reading-neural-voice__error', message); note.setAttribute('role', 'alert'); item.append(note) }
    return item
  }

  renderOffer(voice, state) {
    this.offer.hidden = !voice
    if (!voice) { this.offer.replaceChildren(); delete this.offer.dataset.voice; delete this.offer.dataset.state; return }
    const { name, download, message } = state
    this.offer.dataset.voice = voice.id; this.offer.dataset.state = name
    const size = Math.round(voice.sizeMB)
    const title = element('p', 'reading-neural-offer__title', `Voz natural · ${size} MB`)
    this.offer.setAttribute('role', 'group'); this.offer.setAttribute('aria-label', 'Voz natural')
    const head = [title]
    if (name === 'downloading') head.push(button('Cancelar', 'cancel', voice.id, '', `Cancelar la descarga de ${voice.name}`))
    else head.push(button(name === 'error' ? 'Reintentar' : 'Descargar', 'install', voice.id, 'is-primary', `${name === 'error' ? 'Reintentar la descarga de' : 'Descargar'} la voz natural ${voice.name} (${size} MB)`), button('Ahora no', 'dismiss', '', 'is-quiet'))
    const nodes = [element('div', 'reading-neural-offer__row')]
    nodes[0].append(...head)
    if (name === 'error') { const note = element('p', 'reading-neural-voice__error', message); note.setAttribute('role', 'alert'); nodes.push(note) }
    if (name === 'downloading') nodes.push(progress(`Descargando ${voice.name}`, download, voice))
    this.offer.replaceChildren(...nodes)
  }

  focusKey() {
    const active = document.activeElement
    if (!active || !this.panel.contains(active) || !active.dataset?.neuralAction) return null
    return { action:active.dataset.neuralAction, id:active.dataset.neuralId || '', inOffer:this.offer.contains(active) }
  }
  restoreFocus(key) {
    if (!key) return
    const root = key.inOffer && !this.offer.hidden ? this.offer : this.block
    const all = [...root.querySelectorAll('[data-neural-action]')]
    const same = all.find(node => node.dataset.neuralAction === key.action && (node.dataset.neuralId || '') === key.id)
      || all.find(node => (node.dataset.neuralId || '') === key.id) || all[0]
    same?.focus({ preventScroll:true })
  }
}
