import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(path, 'utf8').replace(/\r\n?/g, '\n')
const builder = read('android/html_to_apk_builder.py')
const apkScript = read('.github/scripts/build_android_apk.py')
const workflow = read('.github/workflows/build-android.yml')
const bookImports = read('.github/scripts/register_book_imports.py')

// The builder holds both MainActivity templates as Python f-strings; split on
// the Kotlin marker so each assertion targets exactly one of them.
const kotlinStart = builder.indexOf('f"""package {package_id}\n')
const javaTemplate = builder.slice(builder.indexOf('f"""package {package_id};'), kotlinStart)
const kotlinTemplate = builder.slice(kotlinStart)

describe('Android high refresh rate vote', () => {
  it('splits the two templates', () => {
    expect(javaTemplate).toContain('public class MainActivity extends BridgeActivity')
    expect(kotlinTemplate).toContain('class MainActivity')
    expect(javaTemplate).not.toContain('fun ')
  })

  it('defines the Java method once with mode pinning and the API 35 frame-rate category', () => {
    expect(javaTemplate.match(/private void applyHighRefreshRate\(\)/g)).toHaveLength(1)
    for (const text of ['preferredDisplayModeId', 'preferredRefreshRate', 'getSupportedModes()',
      'getPhysicalWidth()', 'Build.VERSION.SDK_INT >= 35', 'REQUESTED_FRAME_RATE_CATEGORY_HIGH',
      'import android.view.Display;', 'import android.view.Window;']) expect(javaTemplate).toContain(text)
  })

  it('defines the Kotlin method once with the same behaviour', () => {
    expect(kotlinTemplate.match(/private fun applyHighRefreshRate\(\)/g)).toHaveLength(1)
    for (const text of ['preferredDisplayModeId', 'preferredRefreshRate', 'supportedModes',
      'physicalWidth', 'Build.VERSION.SDK_INT >= 35', 'REQUESTED_FRAME_RATE_CATEGORY_HIGH']) expect(kotlinTemplate).toContain(text)
  })

  it('calls it from onCreate, onResume, onWindowFocusChanged and onConfigurationChanged in both templates', () => {
    for (const template of [javaTemplate, kotlinTemplate]) {
      // Invocations only: the definition is followed by " {{".
      expect(template.match(/applyHighRefreshRate\(\)(?! \{\{)/g)).toHaveLength(4)
      for (const hook of ['onCreate', 'onResume', 'onWindowFocusChanged', 'onConfigurationChanged']) expect(template, hook).toContain(hook)
    }
    const resume = javaTemplate.slice(javaTemplate.indexOf('public void onResume()'))
    expect(resume).toMatch(/onResume\(\) \{\{\s+super\.onResume\(\);\s+applyHighRefreshRate\(\);/)
    expect(resume).toMatch(/if \(hasFocus\) applyHighRefreshRate\(\);/)
    expect(resume).toMatch(/onConfigurationChanged\(Configuration newConfig\) \{\{\s+super\.onConfigurationChanged\(newConfig\);\s+applyHighRefreshRate\(\);/)
  })

  it('keeps every brace of the new code doubled so the f-string still renders', () => {
    for (const template of [javaTemplate, kotlinTemplate]) {
      const method = template.slice(template.indexOf('applyHighRefreshRate() {{'), template.indexOf('applyHighRefreshRate() {{') + 1500)
      expect(method).not.toMatch(/(?<!\{)\{(?!\{)/)
    }
  })

  it('keeps the anchors register_book_imports.py rewrites', () => {
    // f-string braces are doubled in the source; the rendered file has single ones.
    const rendered = template => template.replaceAll('{{', '{').replaceAll('}}', '}')
    const java = rendered(javaTemplate), kotlin = rendered(kotlinTemplate)
    const javaAnchors = ['private ReadAloudBridge speechBridge;', 'if (speechBridge != null) speechBridge.close();',
      'handleAppCallback(intent);', 'handleAppCallback(getIntent());']
    const kotlinAnchors = ['private var speechBridge: ReadAloudBridge? = null', 'speechBridge?.close()',
      'setIntent(intent)\n        handleAppCallback(intent)', 'webView.addJavascriptInterface(InhouseNativeBridge(), "InhouseNative")',
      'handleAppCallback(intent)\n    }\n\n    inner class']
    for (const anchor of javaAnchors) expect(java, anchor).toContain(anchor)
    for (const anchor of kotlinAnchors) expect(kotlin, anchor).toContain(anchor)
    // register_book_imports.py must still be looking for exactly these strings.
    for (const anchor of [...javaAnchors, ...kotlinAnchors]) {
      expect(bookImports, anchor).toContain(JSON.stringify(anchor).slice(1, -1).replaceAll('\\"', '"'))
    }
    // Replacements assume a single occurrence of the call anchors in the Java template.
    for (const anchor of ['handleAppCallback(intent);', 'handleAppCallback(getIntent());', 'if (speechBridge != null) speechBridge.close();']) {
      expect(java.split(anchor).length - 1, anchor).toBe(1)
    }
  })
})

describe('Android version strings', () => {
  const name = apkScript.match(/^ANDROID_VERSION_NAME = "([^"]+)"/m)[1]
  const code = apkScript.match(/^ANDROID_VERSION_CODE = (\d+)/m)[1]

  it('names the output APK after the version', () => {
    expect(apkScript).toContain(`OUTPUT_APK = REPO_ROOT / "inhouse-read-release-v${name}.apk"`)
  })

  it('uses the same version, code, tag and APK name everywhere in the workflow', () => {
    expect(workflow).toContain(`inhouse-read-release-v${name}.apk`)
    expect(workflow).toContain(`android-v${name}`)
    expect(workflow).toContain(`Inhouse Read Android ${name}`)
    expect(workflow).toMatch(new RegExp(`inhouse-read-release-v${name.replaceAll('.', '\\.')}\\.apk \\\\\\n\\s+${name.replaceAll('.', '\\.')} \\\\\\n\\s+${code} \\\\\\n\\s+android-v${name.replaceAll('.', '\\.')} \\\\`))
    // No other APK version may remain (1.1.1.1 is the DNS server, not a version).
    const names = new Set([...workflow.matchAll(/inhouse-read-release-v([\d.]+)\.apk/g)].map(match => match[1]))
    const tags = new Set([...workflow.matchAll(/android-v([\d.]+)/g)].map(match => match[1]))
    expect([...names]).toEqual([name])
    expect([...tags]).toEqual([name])
  })

  it('is newer than the version the installed 1.1.1 app reports', () => {
    const [major, minor, patch] = name.split('.').map(Number)
    expect(major * 1e6 + minor * 1e3 + patch).toBeGreaterThan(1001001)
    expect(Number(code)).toBeGreaterThan(14)
  })
})
