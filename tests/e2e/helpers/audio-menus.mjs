// The audio panel's own dropdowns (Idioma, Voz): there is no <select>, so tests open the list and click the option.
export const audioMenu = (page, name) => page.locator('#reading-audio .select-menu', { has: page.locator('.select-menu__label', { hasText:name }) })

/** Opens the list of "Idioma" or "Voz" when it is closed. */
export async function openAudioMenu(page, name) {
  const menu = audioMenu(page, name)
  if (!(await menu.locator('.select-menu__panel').isVisible())) await menu.locator('.select-menu__trigger').click()
  return menu
}
export async function pickAudioOption(page, name, value) {
  const menu = await openAudioMenu(page, name)
  await menu.locator(`[role="option"][data-value="${value}"]`).click()
}
export const pickVoice = (page, value) => pickAudioOption(page, 'Voz', value)
export const pickLanguage = (page, value) => pickAudioOption(page, 'Idioma', value)
/** Locator of the selected option of a dropdown: toHaveAttribute('data-value', ...) says what is chosen. */
export const selectedOption = (page, name = 'Voz') => audioMenu(page, name).locator('[role="option"][aria-selected="true"]')
