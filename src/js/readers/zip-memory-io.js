// Keep ZIP navigation independent of Blob read/Response tasks after the
// document becomes hidden. One compressed archive is read when opening it;
// decompression, encodings, CRC checks and resource MIME types stay with zip.js.
class ChunkWriter {
  #chunks = []
  constructor() {
    this.writable = new WritableStream({ write: chunk => {
      if (!ArrayBuffer.isView(chunk) || chunk.BYTES_PER_ELEMENT !== 1) throw new TypeError('ZIP output must be bytes')
      this.#chunks.push(new Uint8Array(chunk))
    } })
  }
  init() {}
  get chunks() { return this.#chunks }
  bytes() {
    const output = new Uint8Array(this.#chunks.reduce((sum, chunk) => sum + chunk.length, 0))
    let offset = 0
    for (const chunk of this.#chunks) { output.set(chunk, offset); offset += chunk.length }
    return output
  }
}
class MemoryTextWriter extends ChunkWriter {
  constructor(encoding = 'utf-8') { super(); this.encoding = encoding || 'utf-8' }
  getData() { return new TextDecoder(this.encoding).decode(this.bytes()) }
}
class MemoryBlobWriter extends ChunkWriter {
  constructor(type = '') { super(); this.type = type }
  getData() { return new Blob(this.chunks, { type:this.type }) }
}
export async function createMemoryZipIO(file, BlobReader) {
  const archive = new Uint8Array(await file.arrayBuffer())
  if (archive.length !== file.size) throw new Error('Incomplete ZIP archive')
  class MemoryReader extends BlobReader {
    async readUint8Array(offset, length) {
      // zip.js makes DataViews over the returned buffer, so each slice must
      // start at byte zero; a subarray would corrupt directory/header offsets.
      return archive.slice(offset, offset + length)
    }
  }
  return { reader:new MemoryReader(file), TextWriter:MemoryTextWriter, BlobWriter:MemoryBlobWriter }
}
