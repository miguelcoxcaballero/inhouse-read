import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const source = readFileSync('android/html_to_apk_builder.py', 'utf8').replace(/\r\n?/g, '\n')
const kotlinStart = source.indexOf('f"""package {package_id}\n')
const java = source.slice(source.indexOf('f"""package {package_id};'), kotlinStart)
const kotlin = source.slice(kotlinStart)

describe('Android reading display bridge', () => {
  for (const [name, template] of [['Java', java], ['Kotlin', kotlin]]) {
    it(`${name}: exposes the trusted UI-thread mode setter and keeps normal bars at startup`, () => {
      const setter = template.slice(template.indexOf('setReadingMode('), template.indexOf('getAppVersion('))
      expect(setter).toContain('runOnUiThread')
      expect(setter).toContain('if (!isTrustedReadPage())')
      expect(setter).toContain('readingMode = enabled')
      expect(setter).toContain('applyReadingDisplay()')
      expect(template).toContain('readingMode = false')
      expect(template).toContain('activityResumed = false')
      expect(template).toContain('readingMode && activityResumed && isTrustedReadPage()')
    })

    it(`${name}: wakes the display and hides only status bars while reading`, () => {
      const policy = template.slice(template.indexOf('applyReadingDisplay()'), template.indexOf('// Vote for the panel'))
      expect(policy).toContain('addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)')
      expect(policy).toContain('clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)')
      expect(policy).toContain('controller.hide(WindowInsetsCompat.Type.statusBars())')
      expect(policy).not.toContain('controller.hide(WindowInsetsCompat.Type.systemBars())')
      expect(policy).not.toContain('controller.hide(WindowInsetsCompat.Type.navigationBars())')
      expect(policy).toContain('controller.show(WindowInsetsCompat.Type.statusBars()')
      expect(policy).toContain('BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE')
      expect(policy).toContain('requestApplyInsets')
    })

    it(`${name}: reapplies policy after resume, focus and rotation and releases on pause`, () => {
      for (const hook of ['onPause()', 'onResume()', 'onWindowFocusChanged(', 'onConfigurationChanged(']) {
        const start = template.indexOf(hook)
        expect(template.slice(start, start + 360), hook).toContain('applyReadingDisplay()')
      }
      expect(template.slice(template.indexOf('onPause()'), template.indexOf('onStop()'))).toContain('activityResumed = false')
      expect(template.slice(template.indexOf('onResume()'), template.indexOf('onWindowFocusChanged('))).toContain('activityResumed = true')
    })
  }

  it('removes only the top safe inset in reading and restores all shelf safe insets', () => {
    expect(java).toContain('initialTop + (isReadingDisplayActive() ? 0 : safeInsets.top)')
    expect(kotlin).toContain('initialPadding.top + (if (isReadingDisplayActive()) 0 else safeInsets.top)')
    for (const template of [java, kotlin]) {
      expect(template).toContain('safeInsets.left')
      expect(template).toContain('safeInsets.right')
      expect(template).toContain('safeInsets.bottom')
      expect(template).toContain('.setInsets(safeTypes, Insets.NONE)')
    }
  })
})
