import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const packageInfo = JSON.parse(read('../../package.json'))

describe('published application version', () => {
  it('shows the package version in the application', () => {
    expect(read('../../src/js/app.js')).toContain(`Inhouse Read · v${packageInfo.version}`)
  })

  it('keeps both lockfile version fields aligned with the package', () => {
    const lock = JSON.parse(read('../../package-lock.json'))
    expect(lock.version).toBe(packageInfo.version)
    expect(lock.packages[''].version).toBe(packageInfo.version)
  })
})
