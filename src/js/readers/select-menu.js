// A dropdown drawn by the app instead of the operating system's <select>: a row with the current choice that opens a list
// right below it, inside the panel (no floating layer to clip or to cover the keyboard). ARIA: a button that opens a
// listbox of options; arrows/Home/End/letters move, Enter/Space choose, Escape and Tab close. A tap elsewhere closes it on
// the click (not on the press): closing on the press shifts the layout under the finger and the tap would miss its target.

let openMenu = null
let counter = 0

const element = (tag, className, text) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}
const CHEVRON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>'

export class SelectMenu {
  /** `label` is the visible name of the row ("Idioma"); `extra` (optional) is a node shown under the options, inside the list. */
  constructor({ label, extra = null, onChange = () => {} } = {}) {
    const id = `select-menu-${++counter}`
    this.onChange = onChange
    this.options = []; this.current = ''; this.valueText = ''
    this.root = element('div', 'select-menu')
    this.trigger = element('button', 'select-menu__trigger')
    this.trigger.type = 'button'; this.trigger.id = `${id}-trigger`
    this.trigger.setAttribute('aria-haspopup', 'listbox'); this.trigger.setAttribute('aria-expanded', 'false'); this.trigger.setAttribute('aria-controls', `${id}-panel`)
    this.labelNode = element('span', 'select-menu__label', label)
    this.valueNode = element('span', 'select-menu__value')
    this.trigger.append(this.labelNode, this.valueNode)
    this.trigger.insertAdjacentHTML('beforeend', CHEVRON)
    this.panel = element('div', 'select-menu__panel'); this.panel.id = `${id}-panel`; this.panel.hidden = true
    this.list = element('ul', 'select-menu__list'); this.list.setAttribute('role', 'listbox'); this.list.setAttribute('aria-label', label)
    this.panel.append(this.list)
    if (extra) { this.extra = extra; this.panel.append(extra) }
    this.root.append(this.trigger, this.panel)
    this.trigger.addEventListener('click', () => this.isOpen ? this.close() : this.open())
    this.trigger.addEventListener('keydown', event => {
      if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); this.open(event.key === 'ArrowUp' ? 'last' : 'selected') }
    })
    this.list.addEventListener('click', event => { const item = event.target.closest('[role="option"]'); if (item && !item.getAttribute('aria-disabled')) this.choose(item.dataset.value) })
    this.list.addEventListener('keydown', event => this.keydown(event))
  }

  get isOpen() { return !this.panel.hidden }
  get value() { return this.current }

  /** Replaces the options ({value,label,hint?}) and the selected value; an unknown value falls back to the first option. */
  setOptions(options, value = this.current) {
    this.options = options
    this.current = options.some(option => option.value === value) ? value : (options[0]?.value ?? '')
    this.list.replaceChildren(...options.map((option, index) => {
      const item = element('li', 'select-menu__option')
      item.setAttribute('role', 'option'); item.id = `${this.trigger.id}-${index}`; item.tabIndex = -1; item.dataset.value = option.value
      item.append(element('span', 'select-menu__option-label', option.label))
      if (option.hint) item.append(element('small', 'select-menu__option-hint', option.hint))
      if (option.disabled) item.setAttribute('aria-disabled', 'true')
      return item
    }))
    this.paint()
  }
  setValue(value) { if (this.options.some(option => option.value === value)) { this.current = value; this.paint() } }
  /** Overrides the text shown on the row (e.g. "Automática · Helena"); '' goes back to the selected option's label. */
  setValueText(text) { this.valueText = text || ''; this.paint() }
  setDisabled(disabled) { this.trigger.disabled = Boolean(disabled); if (disabled) this.close() }
  paint() {
    const selected = this.options.find(option => option.value === this.current)
    this.valueNode.textContent = this.valueText || selected?.label || ''
    for (const item of this.list.children) item.setAttribute('aria-selected', String(item.dataset.value === this.current))
  }

  items() { return [...this.list.children].filter(item => !item.getAttribute('aria-disabled')) }
  open(where = 'selected') {
    if (this.isOpen) return
    if (openMenu && openMenu !== this) openMenu.close()
    openMenu = this
    this.panel.hidden = false
    this.trigger.setAttribute('aria-expanded', 'true')
    this.root.classList.add('is-open')
    document.addEventListener('click', this.outside = event => { if (!this.root.contains(event.target)) this.close() }, true)
    const items = this.items()
    const target = where === 'last' ? items.at(-1) : items.find(item => item.dataset.value === this.current) || items[0]
    target?.focus({ preventScroll:true })
    target?.scrollIntoView?.({ block:'nearest' })
    this.panel.scrollIntoView?.({ block:'nearest' })
  }
  close({ focus = false } = {}) {
    if (!this.isOpen) return
    this.panel.hidden = true
    this.trigger.setAttribute('aria-expanded', 'false')
    this.root.classList.remove('is-open')
    document.removeEventListener('click', this.outside, true)
    if (openMenu === this) openMenu = null
    if (focus) this.trigger.focus({ preventScroll:true })
  }
  choose(value) {
    const changed = value !== this.current
    this.current = value; this.paint(); this.close({ focus:true })
    if (changed) this.onChange(value, this.options.find(option => option.value === value))
  }
  keydown(event) {
    const items = this.items(), index = items.indexOf(document.activeElement)
    const move = next => { event.preventDefault(); items[(next + items.length) % items.length]?.focus({ preventScroll:true }); items[(next + items.length) % items.length]?.scrollIntoView?.({ block:'nearest' }) }
    if (event.key === 'ArrowDown') move(index + 1)
    else if (event.key === 'ArrowUp') move(index - 1)
    else if (event.key === 'Home') move(0)
    else if (event.key === 'End') move(items.length - 1)
    else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); const item = items[index]; if (item) this.choose(item.dataset.value) }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close({ focus:true }) }
    else if (event.key === 'Tab') this.close()
    else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const letter = event.key.toLocaleLowerCase('es')
      const from = items.slice(index + 1).concat(items.slice(0, index + 1))
      const hit = from.find(item => item.textContent.trim().toLocaleLowerCase('es').startsWith(letter))
      if (hit) { hit.focus({ preventScroll:true }); hit.scrollIntoView?.({ block:'nearest' }) }
    }
  }
}
