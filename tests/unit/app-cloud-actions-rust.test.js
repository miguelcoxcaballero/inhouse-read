import {afterEach,describe,expect,it,vi} from 'vitest'
import {rustUI as ui} from './helpers/rust-ui-ready.js'
import {rustShelf as shelf} from './helpers/rust-shelf-ready.js'
import {referenceAppCloudActions} from './helpers/reference-app-cloud-actions.js'
import {collect} from './helpers/collect.js'

const markup='<svg class="ihr-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false"><path d="m5 12 4 4L19 6"/></svg>'
const tick=async()=>{for(let n=0;n<30;n++)await Promise.resolve()}
const deferred=()=>{let resolve,reject;const promise=new Promise((done,fail)=>{resolve=done;reject=fail});return{promise,resolve,reject}}
const plain=value=>value instanceof Error?{error:value.message,code:value.code}:value===undefined?'undefined':JSON.parse(JSON.stringify(value))
afterEach(()=>{document.body.replaceChildren();vi.restoreAllMocks()})
function fixture(config={}) {
 const calls=[],log=(name,...args)=>calls.push([name,...args.map(plain)])
 const root=document.createElement('div');root.innerHTML='<button id="connect"></button><button id="sync"></button><button id="profile"></button><section aria-busy="true"></section><button id="cover"><svg><circle r="1"/></svg><span>Save long</span><span class="ihr-btn__label--short">Save short</span></button>'
 document.body.append(root)
 const button=root.querySelector('#cover')
 if(config.icon){button.className='ihr-btn--icon';button.innerHTML='<svg><circle r="1"/></svg>';button.setAttribute('aria-label','Save icon');button.title='Save icon'}
 const state={driveProfile:config.known??null,driveUploadsInFlight:0,cloudRoomChanged:false}
 let connected=config.session??true
 const profile={id:'account',name:'Reader'}
 const host={state,document,savedCheckMarkup:markup,library:{id:'library'},
  els:{driveConnectBtn:root.querySelector('#connect'),driveSyncBtn:root.querySelector('#sync'),driveProfileBtn:root.querySelector('#profile'),driveUploadScreen:root.querySelector('section')},
  hasDriveSession:()=>{log('session',connected);return connected},
  requestDriveAccess:async options=>{log('access',options);if(config.accessError)throw config.accessError;connected=true;return'token'},
  getDriveProfile:async()=>{log('get-profile');if(config.profileError){if(config.expireOnProfile)connected=false;throw config.profileError}return profile},
  getRememberedDriveProfile:()=>{log('remembered');return config.remembered??null},
  isAndroidShell:()=>{log('android');return config.android??false},
  restoreLegacyBookBytes:async library=>{expect(library).toBe(host.library);log('legacy');if(config.legacyError)throw config.legacyError},
  cloudSync:{uploadBook:async book=>{log('upload',book);if(config.uploadError)throw config.uploadError;return config.emptyUpload?null:{id:book.id,driveFileId:'uploaded'}},
    flushProgress:id=>{log('progress',id);return config.progressPending?new Promise(()=>{}):config.progressError?Promise.reject(config.progressError):Promise.resolve()},
    downloadForOffline:async book=>{log('download',book);if(config.downloadError)throw config.downloadError;return{}},
    reset:()=>log('cloud-reset'),setProfile:profile=>log('set-profile',profile)},
  liveRoom:{pause:()=>log('pause'),resume:()=>log('resume')},
  libraryBackup:{reset:()=>log('backup-reset'),sync:async id=>{log('sync',id);if(config.syncError)throw config.syncError;return{synced:id}},poll:async id=>{log('poll',id);return{polled:id}}},
  profileView:{visibility:value=>log('visible',value),localAccount:()=>log('local-account'),account:profile=>log('account',profile),syncStatus:(message,syncing=false)=>log('status',message,syncing)},
  console:{warn:(...args)=>log('warn',...args)},
  showAuthNotice:(message,options={})=>{log('notice',message,options);if(config.noticeError)throw config.noticeError},
  closeProfileMenu:()=>log('close-menu'),offerAvailableAndroidUpdate:async()=>{log('offer-update');if(config.updateError)throw config.updateError;return config.updateAvailable??false},
  signOutDrive:()=>{log('sign-out');connected=false},cancelDriveConnection:()=>log('cancel'),refreshShelf:async()=>log('refresh'),online:()=>config.online??true
 }
 host.setDriveSyncStatus=(...args)=>host.profileView.syncStatus(...args)
 return{host,root,button,calls,state}
}
function bindCallbacks(core,host){
 host.uploadProgressFailure=error=>core.app_drive_upload_progress_failure(host,error)
 host.authFailure=error=>core.app_drive_report_error(host,error)
 host.resumeReady=()=>core.app_drive_resume_ready(host)
 host.resumeFailure=error=>core.app_drive_resume_failure(host,error)
}
function nativeActions(core,host){bindCallbacks(core,host);return {
 handleCoverAction:(...args)=>core.app_drive_cover_action(host,...args),
 uploadBookToDrive:(...args)=>core.app_drive_upload(host,...args),
 loadDriveAccountProfile:()=>core.app_drive_load_profile(host),
 syncLibraryToDrive:options=>core.app_drive_sync(host,options),
 connectGoogleAccount:()=>core.app_drive_connect(host),
 reportDriveConnectionError:error=>core.app_drive_report_error(host,error)
}}
async function scenario(factory,config,action,args=[]) {
 const f=fixture(config),api=factory(f.host),book={id:'book',...config.book}
 let result,failure
 try {result=await api[action](...(action==='handleCoverAction'?[config.action??'drive',book,f.button]:action==='uploadBookToDrive'?[book]:args))}catch(error){failure=plain(error)}
 await tick()
 const snapshot={calls:f.calls,state:plain(f.state),book,result:plain(result),failure,html:f.root.innerHTML,
  disabled:f.button.disabled,busy:f.button.getAttribute('aria-busy'),connected:f.button.isConnected}
 f.root.remove();return snapshot
}
const cases=[
 ['upload while progress hangs',{progressPending:true},'handleCoverAction'],
 ['upload after sign out',{session:false},'handleCoverAction'],
 ['upload failure',{uploadError:Error('offline')},'handleCoverAction'],
 ['upload returned no record',{emptyUpload:true},'handleCoverAction'],
 ['icon upload',{icon:true},'handleCoverAction'],
 ['icon restores failed action',{icon:true,uploadError:Error('denied')},'handleCoverAction'],
 ['offline existing copy',{action:'offline',session:false,book:{content:{bytes:4}}},'handleCoverAction'],
 ['offline OAuth then download',{action:'offline',session:false,book:{driveFileId:'drive-book'}},'handleCoverAction'],
 ['offline missing link',{action:'offline',session:false},'handleCoverAction'],
 ['offline cancelled',{action:'offline',session:false,accessError:Error('Conexión cancelada.')},'handleCoverAction'],
 ['offline download failed',{action:'offline',book:{driveFileId:'drive-book'},downloadError:Error('network')},'handleCoverAction'],
 ['unknown action',{action:'other'},'handleCoverAction'],
 ['progress fails in background',{progressError:Error('progress offline')},'uploadBookToDrive'],
 ['local profile',{session:false,known:{id:'old'}},'loadDriveAccountProfile'],
 ['new account profile',{known:{id:'old'}},'loadDriveAccountProfile'],
 ['remembered offline profile',{profileError:Error('network'),remembered:{id:'cached'}},'loadDriveAccountProfile'],
 ['profile expires during request',{profileError:Error('expired'),expireOnProfile:true},'loadDriveAccountProfile'],
 ['profile missing fallback',{profileError:Error('network')},'loadDriveAccountProfile'],
 ['sync full',{known:{id:'account'}},'syncLibraryToDrive'],
 ['sync poll',{known:{id:'account'}},'syncLibraryToDrive',[{poll:true}]],
 ['sync legacy failure',{known:{id:'account'},legacyError:Error('legacy')},'syncLibraryToDrive'],
 ['silent web without account',{session:false},'syncLibraryToDrive',[{silent:true}]],
 ['silent Android remembered',{session:false,android:true,remembered:{id:'account'}},'syncLibraryToDrive',[{silent:true}]],
 ['silent Android cancellation',{session:false,android:true,remembered:{id:'account'},accessError:Error('cancel')},'syncLibraryToDrive',[{silent:true}]],
 ['connect success',{session:false},'connectGoogleAccount'],
 ['connect cancelled',{session:false,accessError:Error('Conexión cancelada.')},'connectGoogleAccount'],
 ['connect backup failure',{syncError:Error('offline')},'connectGoogleAccount'],
 ['update offered',{updateAvailable:true},'reportDriveConnectionError',[Object.assign(Error('old'),{code:'ANDROID_SHELL_OUTDATED'})]],
 ['update unavailable',{},'reportDriveConnectionError',[Object.assign(Error('old'),{code:'ANDROID_SHELL_OUTDATED'})]],
 ['connect update error',{accessError:Object.assign(Error('old'),{code:'ANDROID_SHELL_OUTDATED'}),updateError:Error('update failure')},'connectGoogleAccount'],
]
describe.each([['shelf',shelf],['reader',ui]])('%s app cloud actions',(_,core)=>{
 const makeFixture=config=>{const f=fixture(config);bindCallbacks(core,f.host);return f}
 it.each(cases)('matches the original flow: %s',async(_label,config,action,args)=>{
  expect(await scenario(host=>nativeActions(core,host),config,action,args)).toEqual(await scenario(referenceAppCloudActions,config,action,args))
 })
 it('counts overlapping uploads and releases the busy overlay only after the last one settles',async()=>{
  const f=makeFixture(),a=deferred(),b=deferred()
  f.host.cloudSync.uploadBook=book=>book.id==='a'?a.promise:b.promise
  const first=core.app_drive_upload(f.host,{id:'a'}),second=core.app_drive_upload(f.host,{id:'b'})
  expect(f.state.driveUploadsInFlight).toBe(2);expect(f.host.els.driveUploadScreen.hidden).toBe(false)
  a.resolve({id:'a'});await first
  expect(f.state.driveUploadsInFlight).toBe(1);expect(f.host.els.driveUploadScreen.hidden).toBe(false)
  b.reject(Error('offline'));await expect(second).rejects.toThrow('offline')
  expect(f.state.driveUploadsInFlight).toBe(0);expect(f.host.els.driveUploadScreen.hidden).toBe(true)
 })
 it('cleans the connect button if error reporting itself fails',async()=>{
  const f=makeFixture({accessError:Object.assign(Error('old'),{code:'ANDROID_SHELL_OUTDATED'}),updateError:Error('report failed')})
  await expect(core.app_drive_connect(f.host)).rejects.toThrow('report failed')
  expect(f.host.els.driveConnectBtn.disabled).toBe(false)
 })
 it('cancels auth immediately, signs out and resets all account owners',async()=>{
  const f=makeFixture({known:{id:'account'}})
  core.app_drive_cancel(f.host);expect(f.calls).toEqual([['cancel'],['notice','',{}]])
  f.calls.length=0;core.app_drive_sign_out(f.host);await tick()
  expect(f.state.driveProfile).toBeNull();expect(f.calls.map(call=>call[0])).toEqual(['sign-out','cloud-reset','pause','backup-reset','close-menu','session','cloud-reset','pause','backup-reset','visible','local-account','notice','refresh'])
  expect(f.host.els.driveProfileBtn.getAttribute('aria-expanded')).toBe('false')
 })
 it('manual sync always re-enables its button after a rejected backup',async()=>{
  const f=makeFixture({known:{id:'account'},syncError:Error('offline')})
  const pending=core.app_drive_manual_sync(f.host);expect(f.host.els.driveSyncBtn.disabled).toBe(true)
  await pending;expect(f.host.els.driveSyncBtn.disabled).toBe(false)
  expect(f.calls).toContainEqual(['status','No se pudo sincronizar: offline',false])
 })
 it('keeps OAuth in the initiating user gesture and releases controls after cancellation',async()=>{
  const f=makeFixture(),gate=deferred();let gesture=true
  f.host.requestDriveAccess=vi.fn(()=>{expect(gesture).toBe(true);return gate.promise})
  const pending=core.app_drive_connect(f.host);gesture=false
  expect(f.host.requestDriveAccess).toHaveBeenCalledOnce();expect(f.host.els.driveConnectBtn.disabled).toBe(true)
  gate.reject(Error('Conexión cancelada.'));await pending
  expect(f.host.els.driveConnectBtn.disabled).toBe(false);expect(f.calls.at(-1)).toEqual(['notice','',{retry:true}])
 })
 it('cleans manual sync even if the rejection has no message or reporting throws',async()=>{
  const f=makeFixture({known:{id:'account'}})
  f.host.libraryBackup.sync=()=>Promise.reject(null)
  await expect(core.app_drive_manual_sync(f.host)).rejects.toThrow()
  expect(f.host.els.driveSyncBtn.disabled).toBe(false)
  f.host.libraryBackup.sync=()=>Promise.reject(Error('offline'))
  f.host.setDriveSyncStatus=()=>{throw Error('report failed')}
  await expect(core.app_drive_manual_sync(f.host)).rejects.toThrow('report failed')
  expect(f.host.els.driveSyncBtn.disabled).toBe(false)
 })
 it('releases fulfilled/rejected background callbacks after their app host is discarded',async()=>{
  const count=core.ui_live_handles??core.shelf_live_handles
  const round=async index=>{
   const f=makeFixture({progressError:index%2?Error('offline'):null})
   await core.app_drive_upload(f.host,{id:'book'})
   core.app_drive_auth_event(f.host,{connected:true})
   await tick();f.root.remove()
  }
  await round(0);await tick();await collect();const baseline=count()
  for(let n=0;n<40;n++)await round(n)
  await tick();await collect();expect(count()).toBe(baseline)
 })
 it('resumes live transport while offline and refreshes only changed rooms after a successful poll',async()=>{
  const offline=makeFixture({online:false});core.app_drive_resume(offline.host,{});expect(offline.calls).toEqual([['resume']])
  const f=makeFixture({known:{id:'account'}});f.state.cloudRoomChanged=true
  core.app_drive_resume(f.host,{poll:true});await tick()
  expect(f.calls).toContainEqual(['poll','account']);expect(f.calls.at(-1)).toEqual(['refresh']);expect(f.calls).not.toContainEqual(['legacy'])
 })
})
