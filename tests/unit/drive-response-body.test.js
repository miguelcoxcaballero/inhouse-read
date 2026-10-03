import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
let drive
const scope='https://www.googleapis.com/auth/drive.file'
const token=()=>JSON.parse(localStorage.getItem('ihr_drive_session_v2')||'null')?.accessToken
const outcome=task=>task.then(value=>({value}),error=>({error}))
beforeEach(async()=>{
 vi.resetModules();localStorage.clear();delete globalThis.InhouseNative
 localStorage.setItem('ihr_drive_session_v2',JSON.stringify({accessToken:'old-test-token',expiresAt:Date.now()+3600_000}))
 vi.stubGlobal('google',{accounts:{oauth2:{initTokenClient:options=>({requestAccessToken:()=>options.callback({access_token:'new-test-token',expires_in:3600,scope})})}}})
 drive=await import('../../src/js/drive-client.js')
})
afterEach(()=>{vi.unstubAllGlobals();delete globalThis.handleInhouseNativeOAuth})
const reconnect=async()=>{drive.signOutDrive();await drive.requestDriveAccess();expect(token()).toBe('new-test-token')}
describe('Drive response bodies after switching account',()=>{
 it('returns current-account JSON through the real Response reader',async()=>{
  vi.stubGlobal('fetch',vi.fn(()=>Promise.resolve(new Response(JSON.stringify({files:[{id:'current-folder'}]}),{headers:{'Content-Type':'application/json'}}))))
  expect(await drive.getOrCreateReadFolder()).toBe('current-folder')
  expect(await drive.getOrCreateReadFolder()).toBe('current-folder')
  expect(fetch).toHaveBeenCalledOnce()
 })
 it('returns current-account bytes without buffering them twice',async()=>{
  const bytes=new Blob(['actual-book-bytes'],{type:'application/epub+zip'})
  const blob=vi.fn(()=>Promise.resolve(bytes))
  vi.stubGlobal('fetch',vi.fn(()=>Promise.resolve({ok:true,status:200,blob})))
  const file=await drive.downloadDriveFile('book-id',{name:'book.epub'})
  expect(file.name).toBe('book.epub');expect(file.size).toBe(bytes.size);expect(file.type).toBe(bytes.type)
  expect(blob).toHaveBeenCalledOnce()
 })
 it('preserves a body parsing error and permits a normal folder retry',async()=>{
  vi.stubGlobal('fetch',vi.fn(()=>Promise.resolve(new Response(fetch.mock.calls.length===1?'{invalid':JSON.stringify({files:[{id:'retry-folder'}]})))))
  expect((await outcome(drive.getOrCreateReadFolder())).error).toBeInstanceOf(SyntaxError)
  expect(await drive.getOrCreateReadFolder()).toBe('retry-folder');expect(fetch).toHaveBeenCalledTimes(2)
 })
 it('invalidates a cached folder when cancelling an authentication generation',async()=>{
  vi.stubGlobal('fetch',vi.fn(()=>Promise.resolve(new Response(JSON.stringify({files:[{id:'current-folder'}]})))))
  expect(await drive.getOrCreateReadFolder()).toBe('current-folder')
  drive.cancelDriveConnection()
  expect(await drive.getOrCreateReadFolder()).toBe('current-folder');expect(fetch).toHaveBeenCalledTimes(2)
 })
 it('does not follow an old folder after its delayed JSON finishes',async()=>{
  let release
  vi.stubGlobal('fetch',vi.fn(()=>fetch.mock.calls.length===1
   ? Promise.resolve({ok:true,status:200,json:()=>new Promise(resolve=>{release=resolve})})
   : Promise.resolve(new Response(JSON.stringify({files:[]})))))
  const result=outcome(drive.listDriveBooks())
  await vi.waitFor(()=>expect(release).toBeTypeOf('function'));await reconnect()
  release({files:[{id:'old-account-folder'}]})
  const r=await result;expect(r.error?.message).toMatch(/ha cambiado/);expect(fetch).toHaveBeenCalledOnce()
 })
 it('does not return an old account file after its delayed bytes finish',async()=>{
  let release
  vi.stubGlobal('fetch',vi.fn(()=>Promise.resolve({ok:true,status:200,blob:()=>new Promise(resolve=>{release=resolve})})))
  const result=outcome(drive.downloadDriveFile('old-book',{name:'book.epub'}))
  await vi.waitFor(()=>expect(release).toBeTypeOf('function'));await reconnect()
  release(new Blob(['old-account-bytes']))
  const r=await result;expect(r.error?.message).toMatch(/ha cambiado/);expect(token()).toBe('new-test-token')
 })
 it('does not return an old account upload after its delayed JSON finishes',async()=>{
  let release
  vi.stubGlobal('fetch',vi.fn(()=>Promise.resolve({ok:true,status:200,json:()=>new Promise(resolve=>{release=resolve})})))
  const result=outcome(drive.uploadDriveFile(new File(['book'],'book.epub'),{parentId:'old-parent'}))
  await vi.waitFor(()=>expect(release).toBeTypeOf('function'));await reconnect()
  release({id:'old-account-upload'})
  const r=await result;expect(r.error?.message).toMatch(/ha cambiado/);expect(token()).toBe('new-test-token')
 })
 it('an old folder rejection does not remove the new account pending folder cache',async()=>{
  const releases=[]
  vi.stubGlobal('fetch',vi.fn(()=>new Promise(resolve=>releases.push(resolve))))
  const old=outcome(drive.getOrCreateReadFolder())
  await vi.waitFor(()=>expect(fetch).toHaveBeenCalledTimes(1));await reconnect()
  const current=outcome(drive.getOrCreateReadFolder())
  await vi.waitFor(()=>expect(fetch).toHaveBeenCalledTimes(2))
  releases[0](new Response(JSON.stringify({error:{message:'old error'}}),{status:401}))
  expect((await old).error?.message).toMatch(/ha cambiado/)
  const repeated=outcome(drive.getOrCreateReadFolder())
  // Flush actual token/fetch microtasks before resolving the account folder.
  await Promise.resolve();await Promise.resolve();await Promise.resolve()
  for(const release of releases.slice(1))release(new Response(JSON.stringify({files:[{id:'new-account-folder'}]})))
  await current;await repeated
  expect(fetch).toHaveBeenCalledTimes(2)
 })
})
