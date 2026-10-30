// "Compartir" in the lifted book's card: the button, and the share flow in Rust that hands the book
// file itself (EPUB or PDF, named and typed as an ebook) to Android's share sheet through the native
// shell, to the Web Share API in a browser, or saves it where files cannot be shared.
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {rustUI as ui} from './helpers/rust-ui-ready.js'
import {rustShelf as shelf} from './helpers/rust-shelf-ready.js'
import {renderBookshelf} from '../../src/js/bookshelf.js'

vi.mock('../../src/js/cover-appearance.js', async importOriginal => ({
  ...await importOriginal(),
  readCoverAspectRatio: vi.fn(async () => null)
}))

const settle=async()=>{for(let n=0;n<40;n++)await Promise.resolve()}
// A real EPUB starts with a stored `mimetype` entry: the ZIP header, then the name and its content.
const epubBytes=(extra=0)=>{
  const head=new Uint8Array(30);head.set([0x50,0x4b,0x03,0x04]);head[26]=8
  const body=new TextEncoder().encode('mimetypeapplication/epub+zip')
  const rest=Uint8Array.from({length:extra},(_,i)=>(i*31+7)&255)
  return new Uint8Array([...head,...body,...rest])
}
// MOBI, AZW and AZW3 share the PalmDB container: its type/creator say BOOKMOBI at byte 60.
const mobiBytes=()=>{const bytes=new Uint8Array(80);bytes.set(new TextEncoder().encode('Novela'),0);bytes.set(new TextEncoder().encode('BOOKMOBI'),60);return bytes}
const pdfBytes=()=>new TextEncoder().encode('%PDF-1.7\n%âãÏÓ\n1 0 obj<<>>endobj\n')
const decode=parts=>Uint8Array.from(atob(parts.join('')),c=>c.charCodeAt(0))

let restore=[]
const stub=(target,key,value)=>{const had=Object.prototype.hasOwnProperty.call(target,key),before=target[key]
  Object.defineProperty(target,key,{value,configurable:true,writable:true})
  restore.push(()=>had?Object.defineProperty(target,key,{value:before,configurable:true,writable:true}):delete target[key])}
afterEach(()=>{for(const undo of restore.reverse())undo();restore=[];document.body.replaceChildren();vi.restoreAllMocks()})

// The APK's InhouseBookShare: begin() opens a session and returns its id; pieces of any other id fail.
function nativeShare(config={}){
  const calls=[],chunks=[]
  let session=0
  stub(window,'InhouseBookShare',{
    begin:(name,type,title)=>{calls.push(['begin',name,type,title]);if(config.begin===false)return '';session++;chunks.length=0;return String(session)},
    append:(id,base64)=>{if(id!==String(session)||config.append===false)return false;chunks.push(base64);calls.push(['append',base64.length]);return true},
    finish:id=>{calls.push(['finish',id]);return id===String(session)&&config.finish!==false}
  })
  return {calls,chunks}
}
function host(config={}){
  const calls=[]
  let connected=config.session??true
  const value={
    document,console:{warn:(...args)=>calls.push(['warn',String(args[1]?.message??args[1])])},
    isAndroidShell:()=>config.android??false,
    hasDriveSession:()=>connected,
    requestDriveAccess:async()=>{calls.push(['access']);if(config.accessError)throw config.accessError;connected=true;return 'token'},
    cloudSync:{downloadForOffline:async book=>{calls.push(['file',book.id])
      if(config.hold)await config.hold
      if(config.downloadError)throw config.downloadError
      if(config.noFile)return null
      return new File([config.bytes??book.content],config.fileName??book.name??'libro',{type:config.fileType??''})}},
    offerAvailableAndroidUpdate:async()=>{calls.push(['offer-update']);return config.updateAvailable??false},
    showAuthNotice:(message,options)=>calls.push(['notice',message])
  }
  return {host:value,calls}
}
function button(){const node=document.createElement('button');node.className='ihr-flyout__share-action';document.body.append(node);return node}

describe('the share button in the lifted book card',()=>{
  const SHELF_WIDTH=390
  const book=(extra={})=>({id:'local:libro.epub:1',title:'Libro',author:'Autor',format:'EPUB',sourceType:'local',
    addedAt:1_700_000_000_000,lastOpenedAt:1_700_000_000_000,progressFraction:0,...extra})
  let container,view
  beforeEach(()=>{container=document.createElement('div');document.body.append(container)})
  afterEach(()=>{view?.destroy?.();view=null})

  it.each([
    ['a local book without an account',{content:new Blob(['epub'])},{connected:false,saved:false}],
    ['a book saved in Drive',{driveFileId:'saved-1',content:new Blob(['epub'])},{connected:true,saved:true}],
    ['a Drive-only book',{sourceType:'drive',driveFileId:'remote-1'},{connected:true,saved:true}],
  ])('offers Compartir for %s and hands the action to the app',async(_,extra,cloud)=>{
    const onBookAction=vi.fn(),value=book(extra)
    view=renderBookshelf(container,[value],{shelfWidth:SHELF_WIDTH,revealDuration:0,onBookAction,getBookCloudState:()=>cloud})
    container.querySelector('.ihr-spine').click()
    const share=await vi.waitFor(()=>{const node=document.querySelector('.ihr-flyout__share-action');expect(node).not.toBeNull();return node})
    expect(share.tagName).toBe('BUTTON')
    expect(share.getAttribute('aria-label')).toBe('Compartir el libro')
    expect(share.title).toBe('Compartir')
    expect(share.querySelector('svg')).not.toBeNull()
    expect(share.closest('.ihr-flyout__actions')).not.toBeNull()
    expect(share.disabled).toBe(false)
    share.click()
    expect(onBookAction).toHaveBeenCalledExactlyOnceWith('share',value,share)
  })

  it('does not offer it for a book that has neither bytes nor a Drive copy',async()=>{
    view=renderBookshelf(container,[book()],{shelfWidth:SHELF_WIDTH,revealDuration:0,onBookAction:vi.fn(),getBookCloudState:()=>({connected:true,saved:false})})
    container.querySelector('.ihr-spine').click()
    await vi.waitFor(()=>expect(document.querySelector('.ihr-flyout__actions')).not.toBeNull())
    expect(document.querySelector('.ihr-flyout__share-action')).toBeNull()
  })
})

describe.each([['shelf',shelf],['ui',ui]])('app_book_share (%s module)',(_,core)=>{
  it('hands a large EPUB to Android in base64 pieces and opens the share sheet',async()=>{
    const native=nativeShare(),{host:h,calls}=host({android:true}),node=button()
    const bytes=epubBytes(900_000)
    const book={id:'b1',title:'El nombre del viento',name:'download (3).bin',content:new Blob([bytes])}
    await core.app_book_share(h,book,node)
    await settle()
    expect(native.calls[0]).toEqual(['begin','El nombre del viento.epub','application/epub+zip','El nombre del viento'])
    expect(native.calls.at(-1)).toEqual(['finish','1'])
    expect(native.chunks.length).toBe(3)
    // Every piece but the last is 384 KiB of raw bytes, each decodable on its own.
    expect(native.chunks.slice(0,-1).every(piece=>piece.length===4*128*1024)).toBe(true)
    expect([...decode(native.chunks)]).toEqual([...bytes])
    expect(calls.filter(call=>call[0]==='notice')).toEqual([])
    expect(node.disabled).toBe(false)
    expect(node.hasAttribute('aria-busy')).toBe(false)
  })

  it.each([
    ['keeps an EPUB name that already has its extension',{name:'Mi libro.EPUB',title:'Otro'},epubBytes(),'Mi libro.epub','application/epub+zip'],
    ['detects a PDF by its bytes',{name:'scan',title:'Apuntes: tema 1/2'},pdfBytes(),'Apuntes_ tema 1_2.pdf','application/pdf'],
    ['trusts the stored format when the bytes say nothing',{name:'notas',title:'Notas',format:'EPUB'},new TextEncoder().encode('zip?'),'Notas.epub','application/epub+zip'],
    ['keeps a MOBI as MOBI',{name:'novela.mobi',title:'Novela'},mobiBytes(),'novela.mobi','application/x-mobipocket-ebook'],
    ['tells an AZW3 from its format label',{name:'kindle',title:'Kindle',format:'AZW3'},mobiBytes(),'Kindle.azw3','application/vnd.amazon.mobi8-ebook'],
    ['recognises FictionBook XML',{name:'cuento',title:'Cuento'},new TextEncoder().encode('\ufeff<?xml version="1.0"?>\n<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0">'),'Cuento.fb2','application/x-fictionbook+xml'],
    ['keeps a comic as CBZ',{name:'tebeo.cbz',title:'Tebeo',format:'CBZ'},new Uint8Array([0x50,0x4b,0x03,0x04,1,2,3]),'tebeo.cbz','application/vnd.comicbook+zip'],
  ])('%s',async(_,fields,bytes,name,type)=>{
    const native=nativeShare(),{host:h}=host({android:true})
    await core.app_book_share(h,{id:'b2',...fields,content:new Blob([bytes])},button())
    await settle()
    expect(native.calls[0].slice(1,3)).toEqual([name,type])
    expect([...decode(native.chunks)]).toEqual([...bytes])
  })

  it('downloads a Drive-only book first, signing in when needed',async()=>{
    const native=nativeShare(),{host:h,calls}=host({android:true,session:false,bytes:epubBytes(),fileName:'Remoto.epub',fileType:'application/epub+zip'})
    await core.app_book_share(h,{id:'b3',title:'Remoto',name:'Remoto.epub',driveFileId:'drive-1'},button())
    await settle()
    expect(calls.map(call=>call[0])).toEqual(['access','file'])
    expect(native.calls[0]).toEqual(['begin','Remoto.epub','application/epub+zip','Remoto'])
  })

  it('asks for the new Android app before signing in or downloading anything',async()=>{
    const {host:h,calls}=host({android:true,session:false})
    await core.app_book_share(h,{id:'b4',title:'T',driveFileId:'drive-1'},button())
    await settle()
    expect(calls.filter(call=>call[0]!=='warn')).toEqual([['notice','Para compartir libros, actualiza la app de Android a la versión 1.1.25 o posterior.']])
  })

  it.each([
    ['its stored size',{sizeBytes:600*1024*1024,driveFileId:'drive-1'},{}],
    ['the downloaded file',{content:new Blob([epubBytes()])},{bytes:{size:600*1024*1024}}],
  ])('refuses a book over 512 MB from %s before streaming it',async(_,fields,config)=>{
    const native=nativeShare(),{host:h,calls}=host({android:true,...config})
    if(config.bytes){h.cloudSync.downloadForOffline=async()=>{calls.push(['file']);return {size:600*1024*1024,type:'application/epub+zip',name:'big.epub',slice:()=>new Blob([epubBytes()])}}}
    await core.app_book_share(h,{id:'b5',title:'Grande',...fields},button())
    await settle()
    expect(native.calls).toEqual([])
    expect(calls.filter(call=>call[0]==='notice')).toEqual([['notice','Este libro pesa más de 512 MB y no se puede compartir desde la app.']])
    if(!config.bytes)expect(calls.some(call=>call[0]==='file')).toBe(false)
  })

  it('runs one share at a time, so pieces of two books never mix',async()=>{
    const native=nativeShare()
    let release;const hold=new Promise(resolve=>{release=resolve})
    const first=host({android:true,hold}),second=host({android:true})
    const one=core.app_book_share(first.host,{id:'b-one',title:'Uno',content:new Blob([epubBytes(800_000)])},button())
    await settle()
    await core.app_book_share(second.host,{id:'b-two',title:'Dos',content:new Blob([pdfBytes()])},button())
    expect(second.calls.filter(call=>call[0]==='notice')).toEqual([['notice','Ya se está preparando un libro para compartir.']])
    release();await one;await settle()
    expect(native.calls.filter(call=>call[0]==='begin')).toEqual([['begin','Uno.epub','application/epub+zip','Uno']])
    expect([...decode(native.chunks)]).toEqual([...epubBytes(800_000)])
    // Once it ended, the next share runs.
    await core.app_book_share(second.host,{id:'b-two',title:'Dos',content:new Blob([pdfBytes()])},button())
    await settle()
    expect(native.calls.filter(call=>call[0]==='begin').at(-1)).toEqual(['begin','Dos.pdf','application/pdf','Dos'])
  })

  it('keeps long names in other scripts under the file system limit',async()=>{
    const native=nativeShare(),{host:h}=host({android:true})
    await core.app_book_share(h,{id:'b12',title:'本'.repeat(120),content:new Blob([epubBytes()])},button())
    await settle()
    const name=native.calls[0][1]
    expect(name.endsWith('.epub')).toBe(true)
    expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(185)
    expect(name.startsWith('本'.repeat(60))).toBe(true)
  })

  it.each([['begin',{begin:false}],['append',{append:false}],['finish',{finish:false}]])('reports a native %s that fails',async(_,config)=>{
    nativeShare(config);const {host:h,calls}=host({android:true}),node=button()
    await core.app_book_share(h,{id:'b6',title:'T',content:new Blob([epubBytes()])},node)
    await settle()
    expect(calls.filter(call=>call[0]==='notice')).toEqual([['notice','No se pudo compartir el libro. Android no pudo preparar el libro para compartirlo.']])
    expect(node.disabled).toBe(false)
  })

  it.each([
    ['a file that is not an ebook',{},{content:new Blob(['plain text'])},'No se pudo compartir el libro. Este archivo no es un libro.'],
    ['a book with neither bytes nor Drive copy',{},{},'No se pudo compartir el libro. Este libro no está en el dispositivo ni en Google Drive.'],
    ['a download that fails',{downloadError:new Error('Sin conexión')},{content:new Blob([epubBytes()])},'No se pudo compartir el libro. Sin conexión'],
  ])('says so for %s',async(_,config,fields,message)=>{
    nativeShare();const {host:h,calls}=host({android:true,...config})
    await core.app_book_share(h,{id:'b7',title:'T',name:'t.txt',...fields},button())
    await settle()
    expect(calls.filter(call=>call[0]==='notice')).toEqual([['notice',message]])
  })

  it('stays quiet when the person cancels the Google sign-in',async()=>{
    nativeShare();const {host:h,calls}=host({android:true,session:false,accessError:new Error('Conexión cancelada.')})
    await core.app_book_share(h,{id:'b8',title:'T',driveFileId:'drive-1'},button())
    await settle()
    expect(calls.filter(call=>call[0]==='notice')).toEqual([])
  })

  it('uses the Web Share API with the ebook file in a browser',async()=>{
    const shared=[]
    stub(navigator,'canShare',data=>data.files?.length===1)
    stub(navigator,'share',async data=>{shared.push(data)})
    const {host:h,calls}=host()
    await core.app_book_share(h,{id:'b9',title:'Web',name:'web',content:new Blob([epubBytes()])},button())
    await settle()
    expect(shared).toHaveLength(1)
    expect(shared[0].title).toBe('Web')
    expect(shared[0].files[0].name).toBe('Web.epub')
    expect(shared[0].files[0].type).toBe('application/epub+zip')
    expect(new Uint8Array(await shared[0].files[0].arrayBuffer())).toEqual(epubBytes())
    expect(calls.filter(call=>call[0]==='notice')).toEqual([])
  })

  it('asks for a second tap when the browser no longer counts the first one',async()=>{
    stub(navigator,'canShare',()=>true)
    stub(navigator,'share',async()=>{throw new DOMException('Must be handling a user gesture','NotAllowedError')})
    const {host:h,calls}=host({session:false,bytes:epubBytes()})
    await core.app_book_share(h,{id:'b13',title:'Web',driveFileId:'drive-1'},button())
    await settle()
    expect(calls.filter(call=>call[0]==='notice')).toEqual([['notice','El libro ya está listo: pulsa Compartir otra vez.']])
  })

  it('treats a closed share sheet as nothing to report',async()=>{
    stub(navigator,'canShare',()=>true)
    stub(navigator,'share',async()=>{throw new DOMException('Share canceled','AbortError')})
    const {host:h,calls}=host()
    await core.app_book_share(h,{id:'b10',title:'Web',content:new Blob([epubBytes()])},button())
    await settle()
    expect(calls.filter(call=>call[0]==='notice')).toEqual([])
  })

  it('saves the file where the browser cannot share files',async()=>{
    stub(navigator,'canShare',()=>false)
    const clicks=[]
    stub(URL,'createObjectURL',file=>{clicks.push(['url',file.name,file.type]);return 'blob:book'})
    stub(URL,'revokeObjectURL',()=>{})
    vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(function(){clicks.push(['click',this.getAttribute('download'),this.getAttribute('href')])})
    const {host:h}=host()
    await core.app_book_share(h,{id:'b11',title:'Guardar',content:new Blob([pdfBytes()])},button())
    await settle()
    expect(clicks).toEqual([['url','Guardar.pdf','application/pdf'],['click','Guardar.pdf','blob:book']])
    expect(document.querySelector('a[download]')).toBeNull()
  })
})
