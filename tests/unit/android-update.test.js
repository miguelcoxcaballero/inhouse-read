import {describe,it,expect,beforeEach,afterEach,vi} from 'vitest'
import {detectInhouseApp,getInstalledAndroidAppVersion,compareSemanticVersions,getUpdater,installAndroidUpdate} from '../../src/js/android-update.js'

describe('shared Inhouse services updater adapter',()=>{
 beforeEach(()=>{window.localStorage.clear();delete window.InhouseNative;window.history.replaceState({},'', '/');vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('offline')))})
 afterEach(()=>{getUpdater().stop();getUpdater().close();vi.unstubAllGlobals()})
 it('only enables inside Android or the explicit app entrypoint',()=>{expect(detectInhouseApp()).toBe(false);window.history.replaceState({},'','/?inhouse_app=1');expect(detectInhouseApp()).toBe(true)})
 it('reads the installed shell version from its native bridge',()=>{window.InhouseNative={getAppVersion:()=> '1.1.9'};expect(getInstalledAndroidAppVersion()).toBe('1.1.9')})
 it('delegates numeric comparison to the canonical updater',()=>{expect(compareSemanticVersions('1.10.0','1.9.9')).toBeGreaterThan(0)})
 it('settings expose both channels and manual checking without a forced gate',()=>{getUpdater().settings();const text=document.body.textContent;expect(text).toContain('Version A');expect(text).toContain('Version B');expect(text).toContain('Check for updates');expect(text).not.toContain('obligatoria')})
 it('Android 1.1.16 and older install through their original ACTION_VIEW bridge',()=>{
  const release={apkUrl:'https://github.com/miguelcoxcaballero/inhouse-read/releases/download/android-v1.1.18/inhouse-read-release-v1.1.18.apk',apkSha256:'a'.repeat(64)}
  const calls=[],bridge=code=>({getAppVersionCode:()=>code,installAppUpdate:(...args)=>calls.push(['installAppUpdate',...args]),installInhouseUpdate:(...args)=>calls.push(['installInhouseUpdate',...args])})
  window.InhouseNative=bridge(29);installAndroidUpdate(release)
  window.InhouseNative=bridge(30);installAndroidUpdate(release)
  expect(calls).toEqual([['installAppUpdate',release.apkUrl,release.apkSha256],['installInhouseUpdate',release.apkUrl,release.apkSha256]])
  delete window.InhouseNative;expect(()=>installAndroidUpdate(release)).toThrow('Open the Android app to install.')
 })
 it('network failure leaves the app usable and explains it on manual checks',async()=>{getUpdater().settings();expect(await getUpdater().check({manual:true})).toBe(false);expect(document.body.textContent).toContain('Could not check for updates');getUpdater().close();expect(document.querySelector('[role=dialog]')).toBeNull()})
})
