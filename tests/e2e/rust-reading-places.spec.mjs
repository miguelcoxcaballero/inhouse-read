import {test,expect} from '@playwright/test'
import {observeRustExports} from './helpers/rust-export-probe.mjs'
test('compiled mobile reader toggles bookmarks and preserves jump history through Rust',async({page},info)=>{
 test.setTimeout(60000);await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'})
 // The bookmark comparison (reading_marked) is no longer an export the page calls: it runs inside the Rust method that
 // paints the bookmark button, reached through the reader's dispatcher. Observe that method by name, and the two
 // commands that are still exports.
 await observeRustExports(page,{store:'placesProof',marker:'reader_bookmark',exports:['reader_bookmark','reader_jump'],methods:{experience_method:['updateBookmarkButton']}})
 const errors=[];page.on('pageerror',error=>errors.push(error.message))
 await page.goto(process.env.IHR_TEST_URL||'./');await page.locator('#file-picker').setInputFiles('tests/e2e/fixtures/reading-journey.pdf')
 await expect(page.locator('#reader-location')).toHaveAttribute('aria-label',/Página 1 de 4/)
 await page.locator('#reader-location').click();await page.getByRole('button',{name:'Marcar esta página',exact:true}).click();await expect(page.locator('[data-bookmark]')).toHaveAttribute('aria-pressed','true')
 await page.locator('[data-bookmark]').click();await expect(page.locator('[data-bookmark]')).toHaveAttribute('aria-pressed','false')
 await page.locator('[data-bookmark]').click();await expect(page.locator('[data-bookmark]')).toHaveAttribute('aria-pressed','true')
 await page.getByRole('spinbutton',{name:'Ir a la página'}).fill('4');await page.getByRole('button',{name:'Ir',exact:true}).click()
 await expect(page.locator('#reader-location')).toHaveAttribute('aria-label',/Página 4 de 4/)
 await expect(page.locator('.reader-return')).toContainText('Página 1 de 4');await page.locator('.reader-return').click()
 await expect(page.locator('#reader-location')).toHaveAttribute('aria-label',/Página 1 de 4/)
 const proof=await page.evaluate(()=>window.placesProof);expect(proof.available).toBe(true)
 expect(proof.instances).toBe(1)
 for(const name of ['experience_method:updateBookmarkButton','reader_bookmark','reader_jump'])expect(proof.calls[name],name).toBeGreaterThan(0)
 // One comparison per painted state at least: marked, unmarked, marked again.
 expect(proof.calls['experience_method:updateBookmarkButton']).toBeGreaterThanOrEqual(3)
 expect(errors).toEqual([]);await info.attach('compiled-reading-places',{body:JSON.stringify(proof),contentType:'application/json'})
})
