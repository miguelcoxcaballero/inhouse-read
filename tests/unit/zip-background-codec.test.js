import {readFileSync} from 'node:fs'
import {Blob} from 'node:buffer'
import {it,expect,vi} from 'vitest'
import {patchFoliateArchive} from '../../scripts/foliate-archive-patch.mjs'
import {createMemoryZipIO} from '../../src/js/readers/zip-memory-io.js'

it('extracts every real EPUB entry without entering the browser native decompression task queue',async()=>{
  const nativeCodec=vi.fn(function(){throw new Error('Native codec task unavailable')})
  vi.stubGlobal('DecompressionStream',nativeCodec)
  vi.stubGlobal('Blob',Blob)
  try {
    // Fresh original vendor module captures the unavailable native codec.
    const zip=await import('../../node_modules/foliate-js/vendor/zip.js?background-codec-regression')
    const patched=patchFoliateArchive(readFileSync('node_modules/foliate-js/view.js','utf8'))
    const configuration=patched.match(/    configure\([^\n]+\)/)?.[0]
    expect(configuration).toBeTruthy()
    Function('configure',configuration)(zip.configure)
    const file=new Blob([readFileSync('tests/e2e/fixtures/reading-journey.epub')])
    const io=await createMemoryZipIO(file,zip.BlobReader)
    const entries=await new zip.ZipReader(io.reader).getEntries()
    expect(entries.length).toBeGreaterThan(4)
    for(const entry of entries){
      const text=await entry.getData(new io.TextWriter(),{checkSignature:true})
      expect(typeof text).toBe('string')
      if(entry.filename==='one.xhtml')expect(text).toContain('quiet room')
    }
    expect(nativeCodec).not.toHaveBeenCalled()
  } finally {vi.unstubAllGlobals()}
})
