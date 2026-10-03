import {createHash} from 'node:crypto'
import {readdir, readFile, writeFile} from 'node:fs/promises'
import {resolve, relative, sep} from 'node:path'
import {pathToFileURL} from 'node:url'
import {createOfflineShell} from '../src/js/offline-shell-worker.js'

const digest = bytes => createHash('sha256').update(bytes).digest('hex')
export function isShellFile(path) {
  return ['index.html', 'download-android.html'].includes(path) ||
    path.startsWith('assets/') && /\.(?:js|mjs|css|webp|png|jpe?g|svg|woff2?|ttf|otf)$/.test(path) ||
    path.startsWith('icons/') || path.startsWith('licenses/') ||
    /^neural-voice\/ort\/(?:ort\.wasm\.min\.mjs|ort-wasm-simd-threaded\.(?:mjs|wasm))$/.test(path) ||
    /^neural-voice\/phon\/piper_phonemize\.(?:mjs|data|wasm)$/.test(path)
}
export async function generateOfflineShell({directory='dist', base='/inhouse-read/'}={}) {
  const root=resolve(directory), entries=[]
  async function walk(folder) {
    for (const item of await readdir(folder, {withFileTypes:true})) {
      const full=resolve(folder,item.name)
      if(item.isDirectory()) { await walk(full); continue }
      const path=relative(root,full).split(sep).join('/')
      if(!isShellFile(path)) continue
      const bytes=await readFile(full)
      entries.push({path, bytes:bytes.length, sha256:digest(bytes)})
    }
  }
  await walk(root); entries.sort((a,b)=>a.path.localeCompare(b.path))
  if(!entries.some(entry=>entry.path==='index.html') || !entries.some(entry=>/^assets\/main-[\w-]+\.js$/.test(entry.path)))
    throw new Error('Offline shell requires the built app HTML and entry module')
  const manifest={base, version:digest(JSON.stringify({base,entries})), entries}
  await writeFile(resolve(root,'offline-shell-manifest.json'),JSON.stringify(manifest,null,2)+'\n')
  await writeFile(resolve(root,'sw.js'),`// Generated atomically versioned shell; no ebooks, model weights or auth.\n(${createOfflineShell.toString()})(self,${JSON.stringify(manifest)});\n`)
  return manifest
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const manifest=await generateOfflineShell({directory:process.argv[2]||'dist'})
  console.log(`Offline shell: ${manifest.entries.length} files, ${manifest.entries.reduce((sum,entry)=>sum+entry.bytes,0)} bytes, ${manifest.version.slice(0,12)}`)
}
