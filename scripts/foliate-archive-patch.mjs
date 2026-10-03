// Vite resolves this against the project root, including when the dependency
// itself is imported from node_modules or a Windows checkout.
const ioModule='/src/js/readers/zip-memory-io.js'
const oldReader='    const reader = new ZipReader(new BlobReader(file))'
const oldText='    const loadText = load(entry => entry.getData(new TextWriter()))'
const oldBlob='    const loadBlob = load((entry, type) => entry.getData(new BlobWriter(type)))'
export function patchFoliateArchive(input) {
  let source=input.replaceAll('\r\n','\n')
  for(const anchor of [oldReader,oldText,oldBlob])if(source.split(anchor).length!==2)throw Error('Unexpected Foliate ZIP loader; review archive byte preservation before building.')
  source=source.replace(oldReader,'    const io = await createMemoryZipIO(file, BlobReader)\n    const reader = new ZipReader(io.reader)')
    .replace(oldText,'    const loadText = load(entry => entry.getData(new io.TextWriter()))')
    .replace(oldBlob,'    const loadBlob = load((entry, type) => entry.getData(new io.BlobWriter(type)))')
  return `import {createMemoryZipIO} from ${JSON.stringify(ioModule)}\n`+source
}
export function foliateArchivePatch() {
  return {name:'inhouse-read-memory-archive',enforce:'pre',transform(source,id) {
    if(!id.split('?')[0].replaceAll('\\','/').endsWith('/node_modules/foliate-js/view.js'))return null
    return {code:patchFoliateArchive(source),map:null}
  }}
}
