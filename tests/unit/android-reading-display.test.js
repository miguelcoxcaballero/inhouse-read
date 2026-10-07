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

  it('never pads the top natively, so the status bar cannot resize the WebView, and keeps the other insets', () => {
    const listener = template => template.slice(template.indexOf('setOnApplyWindowInsetsListener('), template.indexOf('.setInsets(safeTypes, Insets.NONE)'))
    expect(listener(java)).toMatch(/initialLeft \+ safeInsets\.left,\s*initialTop,\s*initialRight/)
    expect(listener(kotlin)).toMatch(/initialPadding\.left \+ safeInsets\.left,\s*initialPadding\.top,\s*initialPadding\.right/)
    for (const template of [java, kotlin]) {
      expect(listener(template)).not.toContain('safeInsets.top')
      expect(listener(template)).not.toContain('isReadingDisplayActive')
      expect(listener(template)).toContain('updateSafeTopInset(windowInsets)')
      expect(template).toContain('safeInsets.left')
      expect(template).toContain('safeInsets.right')
      expect(template).toContain('safeInsets.bottom')
      expect(template).toContain('.setInsets(safeTypes, Insets.NONE)')
      // Capacitor's SystemBars no longer pads the window (it padded the top
      // by the visible bar on older WebViews and before the first load), so
      // this listener also keeps the keyboard's room.
      expect(listener(template)).toContain('isVisible(WindowInsetsCompat.Type.ime())')
      expect(listener(template)).toMatch(/initial(Bottom|Padding\.bottom) \+ bottomInset\)/)
    }
    expect(source).toMatch(/"plugins": \{"SystemBars": \{"insetsHandling": "disable"\}\}/)
  })

  for (const [name, template] of [['Java', java], ['Kotlin', kotlin]]) {
    it(`${name}: reports a top inset that ignores the bar's visibility, in CSS px, and pushes changes`, () => {
      const update = template.slice(template.search(/(void|fun) updateSafeTopInset\(/), template.indexOf('// Vote for the panel'))
      expect(update).toContain('getInsetsIgnoringVisibility(WindowInsetsCompat.Type.statusBars())')
      // Plus everything the shell padded at the top before (cutout, caption bar).
      expect(update).toMatch(/getInsets\(WindowInsetsCompat\.Type\.systemBars\(\) (\||or) WindowInsetsCompat\.Type\.displayCutout\(\)\)\.top/)
      // Physical pixels to CSS px (dp), rounded like the WebView's own layout.
      expect(update).toMatch(/displayMetrics\.density|getDisplayMetrics\(\)\.density/)
      expect(update).toMatch(/topPx \/ density/)
      expect(update).toContain('isTrustedReadPage()')
      expect(update).toContain('window.inhouseSetSafeTop && window.inhouseSetSafeTop(')
      expect(template).toMatch(/@JavascriptInterface\s+(public double getSafeTopInset\(\)|fun getSafeTopInset\(\): Double)/)
    })

    it(`${name}: lets only the trusted page choose the status icons on the UI thread`, () => {
      const setter = template.slice(template.indexOf('setStatusBarAppearance('), template.indexOf('getAppVersion('))
      expect(setter).toContain('runOnUiThread')
      expect(setter).toContain('if (!isTrustedReadPage())')
      expect(setter).toContain('lightStatusBar = lightBackground')
      expect(setter).toContain('applyStatusBarAppearance()')
      const apply = template.slice(template.indexOf('applyStatusBarAppearance() {'), template.indexOf('updateSafeTopInset('))
      expect(apply).toMatch(/setAppearanceLightStatusBars\(lightStatusBar\)|isAppearanceLightStatusBars = light/)
      expect(apply).not.toContain('NavigationBars')
      // Reapplied with the reading policy (resume, focus, rotation).
      expect(template.slice(template.indexOf('applyReadingDisplay() {'), template.indexOf('applyStatusBarAppearance() {'))).toContain('applyStatusBarAppearance()')
    })

    it(`${name}: draws behind a transparent status bar with a stable cutout layout and keeps the navigation bar`, () => {
      const create = template.slice(template.indexOf('onCreate('), template.indexOf('setOnApplyWindowInsetsListener('))
      expect(create).toContain('LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS')
      expect(create).toContain('LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES')
      expect(create).toMatch(/setStatusBarColor\(Color\.TRANSPARENT\)|statusBarColor = Color\.TRANSPARENT/)
      expect(create).not.toMatch(/setStatusBarColor\(bootColor\)|statusBarColor = bootColor/)
      expect(create).toMatch(/setNavigationBarColor\(bootColor\)|navigationBarColor = bootColor/)
      expect(create).toMatch(/AppearanceLightNavigationBars\(isLightMode\)|isAppearanceLightNavigationBars = isLightMode/)
    })
  }
})
