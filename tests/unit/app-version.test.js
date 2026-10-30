import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const packageInfo = JSON.parse(read('../../package.json'))

describe('published application version', () => {
  it('shows the package version in the application', () => {
    // Read from package.json at build time, so every release shows its own number.
    // app.js hands it to the shell (rust-ui/src/app_shell.rs), which writes the label.
    const app = read('../../src/js/app.js'), shell = read('../../rust-ui/src/app_shell.rs')
    expect(app).toContain("import { version as APP_VERSION } from '../../package.json'")
    expect(app).toMatch(/const shellHost = \{[^}]*\bAPP_VERSION\b/)
    expect(shell).toContain('format!("Inhouse Read · v{}",crate::host::text_of(&read(host,"APP_VERSION")?))')
    expect(app + shell).not.toMatch(/Inhouse Read · v\d/)
  })

  it('keeps both lockfile version fields aligned with the package', () => {
    const lock = JSON.parse(read('../../package-lock.json'))
    expect(lock.version).toBe(packageInfo.version)
    expect(lock.packages[''].version).toBe(packageInfo.version)
  })
})
