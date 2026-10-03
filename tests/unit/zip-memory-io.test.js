import {readFileSync} from 'node:fs'
import {Blob as NativeBlob} from 'node:buffer'
import {describe,it,expect,vi,afterEach} from 'vitest'
import {createMemoryZipIO} from '../../src/js/readers/zip-memory-io.js'
import {patchFoliateArchive,foliateArchivePatch} from '../../scripts/foliate-archive-patch.mjs'
import {BlobReader,BlobWriter,TextWriter,ZipReader,configure} from '../../node_modules/foliate-js/vendor/zip.js'
configure({useWebWorkers:false})
afterEach(()=>vi.unstubAllGlobals())
const fixture=()=>new NativeBlob([readFileSync('tests/e2e/fixtures/reading-journey.epub')])
async function entries(reader){const result=await new ZipReader(reader).getEntries();return new Map(result.map(e=>[e.filename,e]))}

describe('memory-backed EPUB archive IO',()=>{
  it('preserves every real compressed entry, encoding and resource MIME type',async()=>{
    vi.stubGlobal('Blob',NativeBlob)
    const file=fixture(),original=await entries(new BlobReader(file)),io=await createMemoryZipIO(file,BlobReader),memory=await entries(io.reader)
    expect([...memory.keys()]).toEqual([...original.keys()])
    for(const [name,entry] of original){
      const text=await entry.getData(new TextWriter()),actual=await memory.get(name).getData(new io.TextWriter())
      expect(actual).toBe(text)
      const before=await entry.getData(new BlobWriter('application/octet-stream')),after=await memory.get(name).getData(new io.BlobWriter('application/octet-stream'))
      expect(after.type).toBe(before.type);expect(new Uint8Array(await after.arrayBuffer())).toEqual(new Uint8Array(await before.arrayBuffer()))
    }
  })
  it('keeps every original entry readable after all Blob read and Response APIs stop completing',async()=>{
    vi.stubGlobal('Blob',NativeBlob)
    const file=fixture(),io=await createMemoryZipIO(file,BlobReader),map=await entries(io.reader)
    const reader=vi.spyOn(NativeBlob.prototype,'arrayBuffer').mockImplementation(()=>new Promise(()=>{}))
    const blobText=vi.spyOn(NativeBlob.prototype,'text').mockImplementation(()=>new Promise(()=>{}))
    const responseBlob=vi.spyOn(Response.prototype,'blob').mockImplementation(()=>new Promise(()=>{}))
    try {
      const chapter=await map.get('one.xhtml').getData(new io.TextWriter())
      expect(chapter).toContain('quiet room')
      for(const entry of map.values())expect(typeof await entry.getData(new io.TextWriter())).toBe('string')
      expect(reader).not.toHaveBeenCalled();expect(blobText).not.toHaveBeenCalled();expect(responseBlob).not.toHaveBeenCalled()
    } finally {reader.mockRestore();blobText.mockRestore();responseBlob.mockRestore()}
  })
  it('reads the compressed input once and returns independent byte-zero slices',async()=>{
    const file=fixture(),read=vi.spyOn(file,'arrayBuffer'),io=await createMemoryZipIO(file,BlobReader)
    const part=await io.reader.readUint8Array(2,6),other=await io.reader.readUint8Array(2,6)
    expect(part.byteOffset).toBe(0);expect(part.buffer.byteLength).toBe(6);part.fill(0)
    expect(other).not.toEqual(part);expect(read).toHaveBeenCalledOnce()
    await entries(io.reader);expect(read).toHaveBeenCalledOnce()
  })
  it('retains multibyte text split between chunks and isolates reused codec buffers',async()=>{
    const io=await createMemoryZipIO(fixture(),BlobReader),text=new io.TextWriter(),stream=text.writable.getWriter(),bytes=new TextEncoder().encode('Español · Ελληνικά · 日本語')
    for(let i=0;i<bytes.length;i++){const chunk=bytes.slice(i,i+1);await stream.write(chunk);chunk[0]=0}
    await stream.close();expect(text.getData()).toBe('Español · Ελληνικά · 日本語');expect(text.getData()).toBe('Español · Ελληνικά · 日本語')
  })
  it('preserves archive corruption rejection instead of accepting damaged content',async()=>{
    const io=await createMemoryZipIO(fixture(),BlobReader),map=await entries(io.reader),entry=[...map.values()].find(e=>!e.directory&&e.uncompressedSize>0)
    const expected=entry.signature;entry.signature=expected^0xffffffff
    // Public entry metadata is copied by zip.js; corruption belongs in the
    // underlying bytes, which the following reader deliberately changes.
    const original=io.reader.readUint8Array.bind(io.reader)
    io.reader.readUint8Array=async(offset,length)=>{const b=await original(offset,length);if(offset>entry.offset&&length>3)b[0]^=255;return b}
    await expect(entry.getData(new io.TextWriter(),{checkSignature:true})).rejects.toThrow()
  })
  it('rejects an incomplete opening read',async()=>{
    await expect(createMemoryZipIO({size:4,arrayBuffer:async()=>new ArrayBuffer(3)},BlobReader)).rejects.toThrow('Incomplete ZIP')
  })
  it('changes only the real archive reader/writers and rejects unknown or repeated transforms',()=>{
    const source=readFileSync('node_modules/foliate-js/view.js','utf8'),patched=patchFoliateArchive(source)
    expect(patched).toContain('new ZipReader(io.reader)');expect(patched).toContain('entry.getData(new io.TextWriter())');expect(patched).toContain('entry.getData(new io.BlobWriter(type))')
    expect(()=>patchFoliateArchive(source.replace('new BlobReader(file)','new UnknownReader(file)'))).toThrow(/Unexpected/)
    expect(()=>patchFoliateArchive(patched)).toThrow(/Unexpected/);expect(()=>patchFoliateArchive(source+source)).toThrow(/Unexpected/)
    expect(foliateArchivePatch().transform(source,'/src/view.js')).toBeNull()
    expect(foliateArchivePatch().transform(source,'C:/repo/node_modules/foliate-js/view.js?raw').code).toBe(patched)
  })
})
