import { test } from '@playwright/test'
// Unrelated browser fixtures must never depend on live Android channel releases.
// Updater cases override these routes with deterministic same-channel catalogs.
// Helpers are cached across files within a worker. Register explicitly in
// each test file; an import-side-effect hook only belongs to the first file.
export function installEmptyUpdateChannels() {
test.beforeEach(async ({page}) => {
 await page.route(/https:\/\/(?:raw\.githubusercontent\.com|api\.github\.com)\/.*\/updates\/[AB]\.json/, route => {
  const channel=route.request().url().includes('B.json')?'B':'A'
  const value={schemaVersion:1,channel,latest:null,releases:[]}
  return route.fulfill({contentType:'application/json',body:JSON.stringify(route.request().url().includes('api.github.com')?{content:Buffer.from(JSON.stringify(value)).toString('base64')}:value)})
 })
})

}
