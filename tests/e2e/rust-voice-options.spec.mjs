import {test,expect} from '@playwright/test'
import {observeRustExports} from './helpers/rust-export-probe.mjs'
test('compiled mobile reader groups languages and ranks natural voices inside Rust',async({page},info)=>{
 test.setTimeout(60000);await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'})
 const errors=[];page.on('pageerror',error=>errors.push(error.message))
 // language_options/voice_options are no longer exports the page calls: the voice part's populateVoices builds both
 // menus inside Rust (voice_flow.rs → voice_menus.rs → voice_options.rs) and hands the rows to the Rust select menus.
 await observeRustExports(page,{store:'optionsProof',marker:'flow_method',exports:['rustselectmenu_setOptions'],methods:{flow_method:['populateVoices','chooseLanguage']}})
 await page.goto(process.env.IHR_TEST_URL||'./');await page.locator('#file-picker').setInputFiles('tests/e2e/fixtures/reading-journey.epub')
 await expect(page.locator('foliate-view')).toBeVisible({timeout:45000});await page.getByRole('button',{name:'Escuchar el libro'}).click()
 const language=page.getByRole('button',{name:/^Idioma/}),voice=page.getByRole('button',{name:/^Voz/})
 await language.click();await expect(language).toHaveAttribute('aria-expanded','true')
 await page.keyboard.press('End');await page.keyboard.press('Enter');await expect(language).toHaveAttribute('aria-expanded','false')
 await voice.click();await expect(voice).toHaveAttribute('aria-expanded','true');await page.keyboard.press('Escape');await expect(voice).toBeFocused()
 const proof=await page.evaluate(()=>window.optionsProof);expect(proof.available).toBe(true);expect(proof.instances).toBe(1)
 for(const name of ['flow_method:populateVoices','flow_method:chooseLanguage'])expect(proof.calls[name],name).toBeGreaterThan(0)
 // Both menus (language and voice) receive their rows from Rust.
 expect(proof.calls.rustselectmenu_setOptions).toBeGreaterThanOrEqual(2);expect(errors).toEqual([])
 await info.attach('compiled-rust-voice-options',{body:JSON.stringify(proof),contentType:'application/json'})
})
