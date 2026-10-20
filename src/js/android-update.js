// Shared updater: users default to B; A requires warning acknowledgement and slide confirmation.
// Automatic releases go to A; B publication or promotion requires an explicit user request.
// A includes A+B and offers the highest global versionCode; B includes only B.
// Edit canonical inhouse-services-updater and sync all five apps.
// Inhouse services updater — host adapter, not an independent updater.
// Edit github.com/miguelcoxcaballero/inhouse-services-updater first, then sync ALL five apps.
// Every release needs a tiny changelog. The publisher mirrors authorized B releases into A.
import '../vendor/inhouse-services-updater/updater.js'

export function detectInhouseApp() {
  const flag=new URLSearchParams(window.location.search).get('inhouse_app')
  if(flag==='0'||flag==='false')return false
  return flag==='1'||flag==='true'||!!window.InhouseNative||/InhouseReadApp\//.test(navigator.userAgent)
}
export function getInstalledAndroidAppVersion() {
  try { const value=window.InhouseNative?.getAppVersion?.(); if(/^\d+\.\d+\.\d+$/.test(value))return value } catch (_) {}
  return navigator.userAgent.match(/InhouseReadApp\/(\d+\.\d+\.\d+)/)?.[1] || '1.0.0'
}
export const compareSemanticVersions=(a,b)=>window.InhouseServicesUpdater.compareVersions(a,b)
// Android 1.1.16 and older (versionCode < 30) carry an installer bridge that
// fails on some phones: a screen opens after the download and closes without
// installing. Their original installAppUpdate (download, SHA-256, ACTION_VIEW)
// works, so those apps update through it. Newer apps use the shared updater.
export function installAndroidUpdate(release) {
  const native=window.InhouseNative
  let installedCode=0
  try { installedCode=Number(native?.getAppVersionCode?.()||0) } catch (_) {}
  if(native?.installAppUpdate&&(installedCode<30||!native.installInhouseUpdate)) native.installAppUpdate(release.apkUrl,release.apkSha256)
  else if(native?.installInhouseUpdate) native.installInhouseUpdate(release.apkUrl,release.apkSha256)
  else throw Error('Open the Android app to install.')
}
let updater
export function getUpdater() {
  return updater ||= window.InhouseServicesUpdater.create({appId:'read',appName:'Inhouse Read',repository:'miguelcoxcaballero/inhouse-read',getVersion:getInstalledAndroidAppVersion,install:installAndroidUpdate,close:hideUpdateSettings})
}
function hideUpdateSettings() {
  const panel = document.getElementById('drive-update-settings')
  if (panel) panel.hidden = true
  document.querySelector('[data-inhouse-update-settings]')?.setAttribute('aria-expanded','false')
}
export function closeAndroidUpdateSettings() {
  if (document.querySelector('#drive-update-settings .isu-inline')) updater?.close()
}
export function initAndroidUpdateChecks() {
  if(!detectInhouseApp())return
  document.documentElement.dataset.inhouseApp='true'
  document.querySelectorAll('[data-inhouse-update-settings]').forEach(button=>{
    button.hidden=false
    button.addEventListener('click',()=>{
      const panel = document.getElementById('drive-update-settings')
      if (!panel) return
      if (!panel.hidden) { closeAndroidUpdateSettings(); return }
      getUpdater().settings('',{container:panel})
      panel.hidden=false
      button.setAttribute('aria-expanded','true')
      panel.querySelector('button[aria-pressed="true"]')?.focus()
    })
  })
  getUpdater().start()
}
export function offerAvailableAndroidUpdate() { return detectInhouseApp()?getUpdater().check({manual:true}):Promise.resolve(false) }
