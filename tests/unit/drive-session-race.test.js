import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
let drive
const scope='https://www.googleapis.com/auth/drive.file'
const response=(body,status=200)=>new Response(JSON.stringify(body),{status})
const storedToken=()=>JSON.parse(localStorage.getItem('ihr_drive_session_v2')||'null')?.accessToken
beforeEach(async()=>{
  vi.resetModules();localStorage.clear()
  delete globalThis.InhouseNative
  localStorage.setItem('ihr_drive_session_v2',JSON.stringify({accessToken:'old-test-token',expiresAt:Date.now()+3600_000}))
  vi.stubGlobal('google',{accounts:{oauth2:{initTokenClient:options=>({requestAccessToken:()=>options.callback({access_token:'new-test-token',expires_in:3600,scope})})}}})
  drive=await import('../../src/js/drive-client.js')
})
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();delete globalThis.handleInhouseNativeOAuth})
async function pendingProfile(){
  let release
  vi.stubGlobal('fetch',vi.fn(()=>new Promise(resolve=>{release=resolve})))
  const task=drive.getDriveProfile();const outcome=task.then(value=>({value}),error=>({error}))
  await vi.waitFor(()=>expect(fetch).toHaveBeenCalledOnce())
  return {outcome,release}
}
describe('stale Drive responses and the current account',()=>{
  it('a previous account 401 cannot remove a newly connected session',async()=>{
    const old=await pendingProfile()
    drive.signOutDrive();await drive.requestDriveAccess()
    expect(storedToken()).toBe('new-test-token')
    old.release(response({error:{message:'old access expired'}},401))
    const result=await old.outcome
    expect(result.error).toBeInstanceOf(Error)
    expect(drive.hasDriveSession()).toBe(true)
    expect(storedToken()).toBe('new-test-token')
  })
  it('a refreshed token survives a late 401 for its predecessor in the same session',async()=>{
    vi.useFakeTimers({toFake:['Date']})
    const old=await pendingProfile()
    vi.setSystemTime(Date.now()+3600_100)
    await drive.requestDriveAccess()
    expect(storedToken()).toBe('new-test-token')
    old.release(response({error:{message:'old access expired'}},401))
    const result=await old.outcome
    expect(result.error).toBeInstanceOf(Error)
    expect(drive.hasDriveSession()).toBe(true)
    expect(storedToken()).toBe('new-test-token')
  })
  it('a 401 for the actual current token still removes the invalid session',async()=>{
    const old=await pendingProfile()
    old.release(response({error:{message:'current access expired'}},401))
    const result=await old.outcome
    expect(result.error?.status||result.error?.message).toBeTruthy()
    expect(drive.hasDriveSession()).toBe(false)
    expect(storedToken()).toBeUndefined()
  })
  it('a successful response from a signed-out account cannot restore its profile',async()=>{
    const old=await pendingProfile()
    drive.signOutDrive();await drive.requestDriveAccess()
    old.release(response({user:{permissionId:'old-account',displayName:'Old account'}}))
    const result=await old.outcome
    expect(result.error?.message).toMatch(/ha cambiado/)
    expect(drive.getRememberedDriveProfile()).toBeNull()
    expect(storedToken()).toBe('new-test-token')
  })
  it('an old folder lookup cannot continue under a different account token',async()=>{
    let release
    vi.stubGlobal('fetch',vi.fn((_url)=>fetch.mock.calls.length===1
      ? new Promise(resolve=>{release=resolve})
      : Promise.resolve(response({files:[]}))))
    const task=drive.listDriveBooks()
    const outcome=task.then(value=>({value}),error=>({error}))
    await vi.waitFor(()=>expect(fetch).toHaveBeenCalledOnce())
    drive.signOutDrive();await drive.requestDriveAccess()
    release(response({files:[{id:'old-account-folder'}]}))
    const result=await outcome
    expect(result.error?.message).toMatch(/ha cambiado/)
    expect(fetch).toHaveBeenCalledOnce()
    expect(storedToken()).toBe('new-test-token')
  })
  it('reconnecting with a reused token still ignores a previous-generation 401',async()=>{
    const old=await pendingProfile()
    drive.signOutDrive()
    vi.stubGlobal('google',{accounts:{oauth2:{initTokenClient:options=>({requestAccessToken:()=>options.callback({access_token:'old-test-token',expires_in:3600,scope})})}}})
    await drive.requestDriveAccess()
    old.release(response({error:{message:'previous request expired'}},401))
    const result=await old.outcome
    expect(result.error).toBeInstanceOf(Error)
    expect(drive.hasDriveSession()).toBe(true)
    expect(storedToken()).toBe('old-test-token')
  })
})

