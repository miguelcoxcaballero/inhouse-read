import { afterEach, describe, expect, it, vi } from 'vitest'
import { SelectMenu } from '../../src/js/readers/select-menu.js'

const OPTIONS = [{ value:'', label:'Automática' }, { value:'es', label:'Español', hint:'3 voces' }, { value:'en', label:'Inglés' }, { value:'fr', label:'Francés', disabled:true }]
let menus = []
function make(onChange = () => {}, label = 'Idioma') {
  const menu = new SelectMenu({ label, onChange }); menu.setOptions(OPTIONS, '')
  document.body.append(menu.root); menus.push(menu)
  return menu
}
const press = (target, key) => target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles:true, cancelable:true }))
afterEach(() => { for (const menu of menus) menu.close(); menus = []; document.body.innerHTML = '' })

describe('SelectMenu (the own dropdown of the app)', () => {
  it('is a button that opens a listbox of options, with the current choice on the row', () => {
    const menu = make()
    expect(menu.trigger.getAttribute('aria-haspopup')).toBe('listbox')
    expect(menu.trigger.getAttribute('aria-expanded')).toBe('false')
    expect(menu.panel.hidden).toBe(true)
    expect(menu.valueNode.textContent).toBe('Automática')
    menu.trigger.click()
    expect(menu.panel.hidden).toBe(false)
    expect(menu.trigger.getAttribute('aria-expanded')).toBe('true')
    const items = [...menu.list.querySelectorAll('[role="option"]')]
    expect(items.map(item => item.textContent)).toEqual(['Automática', 'Español3 voces', 'Inglés', 'Francés'])
    expect(items.map(item => item.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false', 'false'])
    expect(menu.list.getAttribute('role')).toBe('listbox')
    expect(document.activeElement).toBe(items[0]) // focus goes to the selected option
  })
  it('choosing an option reports it once, closes the list and focuses the row; choosing the same one reports nothing', () => {
    const onChange = vi.fn(), menu = make(onChange)
    menu.trigger.click()
    menu.list.querySelector('[data-value="es"]').click()
    expect(onChange).toHaveBeenCalledWith('es', expect.objectContaining({ label:'Español' }))
    expect(menu.value).toBe('es'); expect(menu.valueNode.textContent).toBe('Español')
    expect(menu.panel.hidden).toBe(true); expect(document.activeElement).toBe(menu.trigger)
    menu.trigger.click(); menu.list.querySelector('[data-value="es"]').click()
    expect(onChange).toHaveBeenCalledTimes(1)
  })
  it('works from the keyboard: arrows, Home/End, letters, Enter, and Escape/Tab close it', () => {
    const onChange = vi.fn(), menu = make(onChange)
    press(menu.trigger, 'ArrowDown')
    expect(menu.isOpen).toBe(true)
    const focus = () => document.activeElement.dataset.value
    press(document.activeElement, 'ArrowDown'); expect(focus()).toBe('es')
    press(document.activeElement, 'ArrowDown'); expect(focus()).toBe('en')
    press(document.activeElement, 'ArrowDown'); expect(focus()).toBe('') // the disabled row is skipped and the list wraps
    press(document.activeElement, 'End'); expect(focus()).toBe('en')
    press(document.activeElement, 'Home'); expect(focus()).toBe('')
    press(document.activeElement, 'e'); expect(focus()).toBe('es') // a letter jumps to the next option that starts with it
    press(document.activeElement, 'Enter')
    expect(onChange).toHaveBeenCalledWith('es', expect.anything())
    expect(menu.isOpen).toBe(false)
    menu.open(); press(document.activeElement, 'Escape')
    expect(menu.isOpen).toBe(false); expect(document.activeElement).toBe(menu.trigger)
    menu.open(); press(document.activeElement, 'Tab'); expect(menu.isOpen).toBe(false)
  })
  it('a disabled option cannot be chosen', () => {
    const onChange = vi.fn(), menu = make(onChange)
    menu.trigger.click(); menu.list.querySelector('[data-value="fr"]').click()
    expect(onChange).not.toHaveBeenCalled(); expect(menu.isOpen).toBe(true)
  })
  it('only one list is open at a time, and a press outside closes it', () => {
    const first = make(), second = make(() => {}, 'Voz')
    first.trigger.click(); second.trigger.click()
    expect(first.isOpen).toBe(false); expect(second.isOpen).toBe(true)
    document.body.dispatchEvent(new Event('click', { bubbles:true }))
    expect(second.isOpen).toBe(false)
    second.trigger.click(); second.panel.dispatchEvent(new Event('click', { bubbles:true }))
    expect(second.isOpen).toBe(true) // a press inside it does not
  })
  it('an unknown value falls back to the first option, and the row text can be overridden', () => {
    const menu = make()
    menu.setOptions(OPTIONS, 'zz')
    expect(menu.value).toBe('')
    menu.setValueText('Automática · Helena')
    expect(menu.valueNode.textContent).toBe('Automática · Helena')
    menu.setValueText('')
    expect(menu.valueNode.textContent).toBe('Automática')
  })
  it('can host extra content under the options', () => {
    const extra = document.createElement('p'); extra.textContent = 'Voces naturales'
    const menu = new SelectMenu({ label:'Voz', extra }); document.body.append(menu.root); menus.push(menu)
    expect(menu.panel.contains(extra)).toBe(true)
  })
  it('a disabled menu cannot be opened', () => {
    const menu = make(); menu.setDisabled(true)
    expect(menu.trigger.disabled).toBe(true)
  })
})
