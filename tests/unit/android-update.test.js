import {describe,it,expect,beforeEach,afterEach,vi} from 'vitest'
import {detectInhouseApp,getInstalledAndroidAppVersion,compareSemanticVersions,getUpdater} from '../../src/js/android-update.js'

describe('shared Inhouse services updater adapter',()=>{
 beforeEach(()=>{window.localStorage.clear();delete window.InhouseNative;window.history.replaceState({},'', '/');vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('offline')))})
 afterEach(()=>{getUpdater().stop();getUpdater().close();vi.unstubAllGlobals()})
 it('only enables inside Android or the explicit app entrypoint',()=>{expect(detectInhouseApp()).toBe(false);window.history.replaceState({},'','/?inhouse_app=1');expect(detectInhouseApp()).toBe(true)})
 it('reads the installed shell version from its native bridge',()=>{window.InhouseNative={getAppVersion:()=> '1.1.9'};expect(getInstalledAndroidAppVersion()).toBe('1.1.9')})
 it('delegates numeric comparison to the canonical updater',()=>{expect(compareSemanticVersions('1.10.0','1.9.9')).toBeGreaterThan(0)})
 it('settings expose both channels and manual checking without a forced gate',()=>{getUpdater().settings();const text=document.body.textContent;expect(text).toContain('Versión A');expect(text).toContain('Versión B');expect(text).toContain('Buscar actualizaciones');expect(text).not.toContain('obligatoria')})
 it('network failure leaves the app usable and explains it on manual checks',async()=>{getUpdater().settings();expect(await getUpdater().check({manual:true})).toBe(false);expect(document.body.textContent).toContain('No se pudo comprobar');getUpdater().close();expect(document.querySelector('[role=dialog]')).toBeNull()})
})
