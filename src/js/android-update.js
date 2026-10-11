// Shared updater: users default to B; A requires warning acknowledgement and slide confirmation. Publish new changes to A; promote B only on explicit user request. Edit canonical inhouse-services-updater and sync all five apps.
// Inhouse services updater — host adapter, not an independent updater.
// Edit github.com/miguelcoxcaballero/inhouse-services-updater first, then sync ALL five apps.
// New versions ALWAYS go to A with a tiny changelog; B requires an explicit user request.
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
let updater
export function getUpdater() {
  return updater ||= window.InhouseServicesUpdater.create({appId:'read',appName:'Inhouse Read',repository:'miguelcoxcaballero/inhouse-read',getVersion:getInstalledAndroidAppVersion})
}
export function initAndroidUpdateChecks() {
  if(!detectInhouseApp())return
  document.documentElement.dataset.inhouseApp='true'
  document.querySelectorAll('[data-inhouse-update-settings]').forEach(button=>{button.hidden=false;button.addEventListener('click',()=>getUpdater().settings())})
  getUpdater().start()
}
export function offerAvailableAndroidUpdate() { return detectInhouseApp()?getUpdater().check({manual:true}):Promise.resolve(false) }
