import { test, expect } from '@playwright/test'
import { fakeEngineScript } from '../helpers/fake-neural-engine.js'
import { readingOrderPDF, PDF_ORDER_PARAGRAPHS, PDF_ORDER_PAGE_TWO } from './fixtures/pdf-reading-order.mjs'

const squash = text => String(text).replace(/\s+/g, '')
const sentences = paragraphs => paragraphs.flatMap(text => text.match(/[^.!?]+[.!?]/g).map(sentence => sentence.trim()))
for (const repeatParagraphs of [false, true]) for (const mode of ['original', 'text']) test(`PDF ${mode}: columns, wrapped paragraphs and narration have the same complete visual order${repeatParagraphs ? ' with header omission enabled' : ''}`, async ({ page }, testInfo) => {
  const pageTwo = repeatParagraphs ? [...PDF_ORDER_PAGE_TWO, 'A pause.', 'A pause.'] : PDF_ORDER_PAGE_TWO
  const expectedSpeech = sentences([...PDF_ORDER_PARAGRAPHS, ...pageTwo])
  test.setTimeout(90_000)
  await page.setViewportSize({ width:390, height:844 })
  await page.emulateMedia({ reducedMotion:'reduce' })
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(fakeEngineScript({ installed:['piper:en_US-lessac-high'], speakMs:100, startDelay:20 }) + `;
    window.__speechHighlight = () => {
      const highlight = CSS.highlights.get('inhouse-speech');
      return highlight ? [...highlight].map(range => range.toString()).join('') : '';
    };
  `)
  if (repeatParagraphs) await page.addInitScript(() => localStorage.setItem('inhouse-read-reading-preferences', JSON.stringify({ skipHeaders:true })))
  await page.goto(process.env.IHR_TEST_URL || './')
  await page.locator('#file-picker').setInputFiles({ name:'Visual reading order.pdf', mimeType:'application/pdf', buffer:readingOrderPDF({ repeatParagraphs }) })
  await expect(page.locator('#reader-location')).toHaveAttribute('aria-label', /Página 1 de 2/)
  await expect(page.locator('.pdf-text-layer span').first()).toBeVisible()
  if (mode === 'text') {
    await page.getByRole('button', { name:'Aspecto de lectura' }).click()
    await page.getByRole('combobox', { name:'Vista del PDF' }).selectOption('text')
    await page.getByRole('button', { name:'Cerrar opciones de lectura' }).click()
    await expect(page.locator('.pdf-reflow-page')).toBeVisible()
    expect(await page.locator('.pdf-reflow-page').evaluate(element => element.textContent.split(/\n{2,}/))).toEqual(PDF_ORDER_PARAGRAPHS)
  } else {
    const visualItems = await page.locator('.pdf-text-layer span').allTextContents()
    expect(visualItems.filter(text => text.trim()).map(text => text.trim())).toEqual([
      PDF_ORDER_PARAGRAPHS[0], 'The left sentence begins on one line and',
      'continues on the next line without a pause.', 'A second sentence stays in the same paragraph.',
      'A wider gap starts a new paragraph.', 'Its second line still belongs here.',
      'Only after the left column comes the right.', 'Every phrase must stay in visual order.',
      'This is the last paragraph on the right.', 'No sentence is skipped or repeated.'
    ])
  }
  await testInfo.attach(`ordered-page-${mode}`, { body:await page.screenshot(), contentType:'image/png' })
  await page.getByRole('button', { name:'Escuchar el libro' }).click()
  await page.getByRole('button', { name:'Reproducir', exact:true }).click()
  await expect(page.locator('.reading-audio-status')).toHaveText('Final del libro.', { timeout:30_000 })
  const calls = await page.evaluate(() => window.__inhouseNeuralTest.engine.calls)
  expect(calls.map(call => call.text)).toEqual(expectedSpeech)
  for (const call of calls) {
    expect(call.atStart).not.toBeNull()
    expect(squash(call.atStart)).toContain(squash(call.text))
  }
  await expect(page.locator('#reader-location')).toHaveAttribute('aria-label', /Página 2 de 2/)
  if (mode === 'text') expect(await page.locator('.pdf-reflow-page').evaluate(element => element.textContent.split(/\n{2,}/))).toEqual(pageTwo)
  await testInfo.attach(`narrated-pdf-${mode}`, { body:JSON.stringify({ paragraphs:PDF_ORDER_PARAGRAPHS, pageTwo, skipHeaders:repeatParagraphs, calls, errors }), contentType:'application/json' })
  expect(errors).toEqual([])
})
