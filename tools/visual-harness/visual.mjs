#!/usr/bin/env node
// Inhouse Read - deterministic visual-regression harness (lives OUTSIDE the repo).
//
//   node visual.mjs capture <distDir> <outDir> <port> [--only <regex>] [--viewport mobile|desktop|both]
//                           [--workers N] [--retries N] [--timeout-s N] [--list]
//   node visual.mjs compare <dirA> <dirB> [--out <diffDir>] [--mean 0.35] [--pct8 0.5] [--only <regex>] [--allow-missing]
//
// capture : serves <distDir> with `vite preview` on 127.0.0.1:<port> (own server, killed on exit), drives headless
//           Chromium (SwiftShader software GL) through a fixed list of shelf states and writes
//           <outDir>/<state>-<390|1280>.png + <state>-<390|1280>.json + diagnostics.json + capture-report.json.
// compare : decodes both PNG sets itself (zlib, no dependencies), prints a per-state table, writes amplified x8 diff PNGs,
//           exits 1 when any state has mean abs diff > 0.35 or > 0.5% of pixels differing by more than 8/255 (or is missing /
//           differently sized).
import { createRequire } from 'node:module'
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import zlib from 'node:zlib'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = process.env.IHR_REPO || '/home/user/inhouse-read'
const HERE = path.dirname(fileURLToPath(import.meta.url))
const sleep = ms => new Promise(r => setTimeout(r, ms))
const argv = process.argv.slice(2)
const flag = (name, def) => { const i = argv.indexOf('--' + name); if (i < 0) return def; const v = argv[i + 1]; return v === undefined || v.startsWith('--') ? true : v }
const positional = () => { const out = []; for (let i = 1; i < argv.length; i++) { if (argv[i].startsWith('--')) { const nxt = argv[i + 1]; if (nxt !== undefined && !nxt.startsWith('--') && !['list', 'allow-missing'].includes(argv[i].slice(2))) i++; } else out.push(argv[i]) } return out }

// =====================================================================================================================
// PNG codec (8-bit, non-interlaced, colour types 0/2/3/4/6) - just enough for Playwright screenshots + diff output
// =====================================================================================================================
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } return t })()
const crc32 = buf => { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG')
  let pos = 8, w = 0, h = 0, depth = 0, ctype = 0, interlace = 0, plte = null; const idat = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString('latin1', pos + 4, pos + 8), data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; ctype = data[9]; interlace = data[12] }
    else if (type === 'PLTE') plte = data
    else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    pos += 12 + len
  }
  if (depth !== 8 || interlace) throw new Error(`unsupported PNG (depth ${depth}, interlace ${interlace})`)
  const bpp = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype]; if (!bpp) throw new Error('unsupported colour type ' + ctype)
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * bpp, cur = new Uint8Array(stride), prev = new Uint8Array(stride)
  const rgba = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0; let v = line[i]
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c }
      cur[i] = v & 255
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      if (ctype === 6) { rgba[o] = cur[x * 4]; rgba[o + 1] = cur[x * 4 + 1]; rgba[o + 2] = cur[x * 4 + 2]; rgba[o + 3] = cur[x * 4 + 3] }
      else if (ctype === 2) { rgba[o] = cur[x * 3]; rgba[o + 1] = cur[x * 3 + 1]; rgba[o + 2] = cur[x * 3 + 2]; rgba[o + 3] = 255 }
      else if (ctype === 0) { rgba[o] = rgba[o + 1] = rgba[o + 2] = cur[x]; rgba[o + 3] = 255 }
      else if (ctype === 4) { rgba[o] = rgba[o + 1] = rgba[o + 2] = cur[x * 2]; rgba[o + 3] = cur[x * 2 + 1] }
      else { const k = cur[x] * 3; rgba[o] = plte[k]; rgba[o + 1] = plte[k + 1]; rgba[o + 2] = plte[k + 2]; rgba[o + 3] = 255 }
    }
    prev.set(cur)
  }
  return { width: w, height: h, data: rgba }
}
function encodePng(width, height, rgba) {
  const stride = width * 4, raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) { raw[y * (stride + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1) }
  const chunk = (type, data) => { const out = Buffer.alloc(12 + data.length); out.writeUInt32BE(data.length, 0); out.write(type, 4, 'latin1'); data.copy(out, 8)
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length); return out }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))])
}

// =====================================================================================================================
// COMPARE
// =====================================================================================================================
function diffImages(A, B, writeDiff) {
  const r = { sizeMatch: A.width === B.width && A.height === B.height, wA: A.width, hA: A.height, wB: B.width, hB: B.height }
  if (!r.sizeMatch) return r
  const n = A.width * A.height, a = A.data, b = B.data
  let sum = 0, max = 0, c2 = 0, c8 = 0, minX = Infinity, minY = Infinity, maxX = -1, maxY = -1
  const out = writeDiff ? new Uint8Array(n * 4) : null
  for (let i = 0, p = 0; p < n; p++, i += 4) {
    const d0 = Math.abs(a[i] - b[i]), d1 = Math.abs(a[i + 1] - b[i + 1]), d2 = Math.abs(a[i + 2] - b[i + 2]), m = Math.max(d0, d1, d2)
    sum += d0 + d1 + d2; if (m > max) max = m
    if (m > 2) { c2++; const x = p % A.width, y = (p / A.width) | 0; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y }
    if (m > 8) c8++
    if (out) { out[i] = Math.min(255, d0 * 8); out[i + 1] = Math.min(255, d1 * 8); out[i + 2] = Math.min(255, d2 * 8); out[i + 3] = 255 }
  }
  Object.assign(r, { mean: sum / (n * 3), max, pct2: 100 * c2 / n, pct8: 100 * c8 / n, count2: c2, count8: c8, bbox: c2 ? [minX, minY, maxX, maxY] : null, diffRgba: out })
  return r
}
const DIAG_KEYS = ['sceneDrawCalls', 'scenePrograms', 'sceneGeometries', 'sceneTextures', 'pixelRatio', 'lampLightCount', 'lampShadowCount', 'activeBooks', 'activeLamps', 'activePlants', 'detailedBooks', 'overviewBooks', 'highResolutionBooks', 'shadowMapSize']
async function compare() {
  const [dirA, dirB] = positional().map(p => path.resolve(p))
  if (!dirA || !dirB) { console.error('usage: compare <dirA> <dirB> [--out dir]'); process.exit(2) }
  const meanLimit = Number(flag('mean', 0.35)), pctLimit = Number(flag('pct8', 0.5)), only = flag('only', null) && new RegExp(flag('only'))
  const outDir = path.resolve(flag('out', path.join(HERE, 'diff', `${path.basename(dirA)}__vs__${path.basename(dirB)}`)))
  const list = d => readdirSync(d).filter(f => f.endsWith('.png')).map(f => f.slice(0, -4)).sort()
  const A = new Set(list(dirA)), B = new Set(list(dirB)), names = [...new Set([...A, ...B])].sort().filter(n => !only || only.test(n))
  await mkdir(outDir, { recursive: true })
  const rows = [], failures = []
  const diagOf = (dir, name) => { try { return JSON.parse(readFileSync(path.join(dir, name + '.json'), 'utf8')).scene || null } catch { return null } }
  for (const name of names) {
    const row = { name }
    if (!A.has(name) || !B.has(name)) { row.missing = A.has(name) ? 'B' : 'A'; rows.push(row); if (!flag('allow-missing', false)) failures.push(`${name}: MISSING in ${row.missing}`); continue }
    const imgA = decodePng(await readFile(path.join(dirA, name + '.png'))), imgB = decodePng(await readFile(path.join(dirB, name + '.png')))
    const d = diffImages(imgA, imgB, true); Object.assign(row, d)
    if (!d.sizeMatch) failures.push(`${name}: SIZE ${d.wA}x${d.hA} vs ${d.wB}x${d.hB}`)
    else {
      const why = []; if (d.mean > meanLimit) why.push(`mean ${d.mean.toFixed(3)} > ${meanLimit}`); if (d.pct8 > pctLimit) why.push(`${d.pct8.toFixed(3)}% px > 8/255 (limit ${pctLimit}%)`)
      if (why.length) { row.fail = why.join('; '); failures.push(`${name}: ${row.fail}`) }
      if (d.mean > 0.005 || d.pct2 > 0.005 || d.max > 16) {
        const png = path.join(outDir, name + '-diff.png'); await writeFile(png, encodePng(d.width ?? imgA.width, imgA.height, d.diffRgba)); row.diffPng = png
      }
    }
    delete row.diffRgba
    const dA = diagOf(dirA, name), dB = diagOf(dirB, name)
    if (dA && dB) row.diagDelta = DIAG_KEYS.filter(k => dA[k] !== dB[k]).map(k => `${k}:${dA[k]}->${dB[k]}`)
    rows.push(row)
  }
  const pad = (s, n) => String(s).padEnd(n), rpad = (s, n) => String(s).padStart(n)
  const w = Math.max(5, ...rows.map(r => r.name.length))
  console.log(`\nA = ${dirA}\nB = ${dirB}\nlimits: mean abs diff <= ${meanLimit}, % px > 8/255 <= ${pctLimit}\n`)
  console.log(`${pad('state', w)}  ${pad('size', 5)} ${rpad('mean', 8)} ${rpad('max', 4)} ${rpad('%>2', 8)} ${rpad('%>8', 8)}  bbox(>2/255)            verdict`)
  for (const r of rows) {
    if (r.missing) { console.log(`${pad(r.name, w)}  MISSING in ${r.missing}  FAIL`); continue }
    if (!r.sizeMatch) { console.log(`${pad(r.name, w)}  NO    ${r.wA}x${r.hA} vs ${r.wB}x${r.hB}  FAIL`); continue }
    const bb = r.bbox ? `[${r.bbox.join(',')}] ${r.bbox[2] - r.bbox[0] + 1}x${r.bbox[3] - r.bbox[1] + 1}` : '-'
    console.log(`${pad(r.name, w)}  ${pad('ok', 5)} ${rpad(r.mean.toFixed(4), 8)} ${rpad(r.max, 4)} ${rpad(r.pct2.toFixed(4), 8)} ${rpad(r.pct8.toFixed(4), 8)}  ${pad(bb, 22)}  ${r.fail ? 'FAIL' : (r.max === 0 ? 'identical' : 'ok')}`)
  }
  const dd = rows.filter(r => r.diagDelta && r.diagDelta.length)
  if (dd.length) { console.log('\nscene diagnostics that differ (informational):'); for (const r of dd) console.log(`  ${r.name}: ${r.diagDelta.join(', ')}`) }
  const diffs = rows.filter(r => r.diffPng); if (diffs.length) console.log(`\n${diffs.length} diff image(s) (x8 amplified) in ${outDir}`)
  const ok = rows.filter(r => !r.missing && r.sizeMatch)
  if (ok.length) console.log(`\nsummary: ${ok.length} compared, ${ok.filter(r => r.max === 0).length} bit-identical, worst mean ${Math.max(...ok.map(r => r.mean)).toFixed(4)}, worst max ${Math.max(...ok.map(r => r.max))}, worst %>8 ${Math.max(...ok.map(r => r.pct8)).toFixed(4)}`)
  await writeFile(path.join(outDir, 'compare-report.json'), JSON.stringify({ dirA, dirB, rows: rows.map(({ diffRgba, ...r }) => r), failures }, null, 1))
  if (failures.length) { console.log(`\nRESULT: FAIL (${failures.length})`); for (const f of failures) console.log('  - ' + f); process.exit(1) }
  console.log('\nRESULT: PASS')
}

// =====================================================================================================================
// CAPTURE
// =====================================================================================================================
const VIEWPORTS = {
  mobile: { tag: '390', opts: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true } },
  desktop: { tag: '1280', opts: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, hasTouch: false, isMobile: false } }
}
const CHROME_EXE = process.env.IHR_CHROME || '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell'
const CHROME_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
  '--force-color-profile=srgb', '--disable-lcd-text', '--font-render-hinting=none', '--hide-scrollbars', '--disable-features=PaintHolding']

// ---- libraries ---------------------------------------------------------------------------------------------------
const PLANT = (key, catalogId, potId, width, height, shelf, x) => ({ key: 'plant:' + key, seed: key, catalogId, variant: catalogId, potId, width, height, shelf, x })
const LAMP = (key, lampId, shelf, x, isOn = true) => ({ key: 'lamp:' + key, lampId, shelf, x, isOn })
const LIBS = {
  // shelf-motion-performance.spec.mjs seedShelf(): 6 books, one plant, one lamp.
  six: { books: 6, plants: [PLANT('motion', 'sansevieria', 'muskot', 42, 124, 0, .76)], lamps: [LAMP('motion', 'tarnaby', 1, .56)] },
  // ~20 books with mixed finishes, auto placed (no shelfPosition), several plants and lamps.
  twenty: { books: 20, plants: [PLANT('t-monstera', 'monstera', 'gradvis', 92, 126, 0, .83), PLANT('t-cactus', 'cactus', 'akerbar', 56, 90, 1, .9), PLANT('t-succ', 'succulent', 'muskotblomma', 66, 72, 2, .12)],
    lamps: [LAMP('t-tarnaby', 'tarnaby', 1, .62), LAMP('t-tripod', 'tripod', 0, .45)] },
  // lamp-heavy: the 6-book shelf with 4 lamps lit.
  heavy: { books: 6, plants: [PLANT('motion', 'sansevieria', 'muskot', 42, 124, 0, .76)],
    lamps: [LAMP('h-tarnaby', 'tarnaby', 1, .56), LAMP('h-tripod0', 'tripod', 0, .5), LAMP('h-tripod2', 'tripod', 2, .66), LAMP('h-mittled', 'mittled', 2, .5)] }
}

// Runs in the page: creates the app DB (same schema as library-store.js, version 2) and fills it.
async function seedBooksInPage({ bytesB64, kind, count }) {
  const bin = atob(bytesB64), bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open('inhouse-read', 2)
    req.onupgradeneeded = () => { const d = req.result
      if (!d.objectStoreNames.contains('books')) d.createObjectStore('books', { keyPath: 'id' }).createIndex('lastOpenedAt', 'lastOpenedAt')
      if (!d.objectStoreNames.contains('removed-books')) d.createObjectStore('removed-books', { keyPath: 'id' }) }
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error)
  })
  const T0 = 1750000000000, records = []
  if (kind === 'six') {
    const cols = ['#18364b', '#713b42', '#375a46']
    for (let index = 0; index < count; index++) {
      const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 600
      const context = canvas.getContext('2d'); context.fillStyle = cols[Math.floor(index / 2)]; context.fillRect(0, 0, 400, 600)
      context.fillStyle = '#e8e2cf'; context.font = '32px serif'; context.fillText(`LIBRO ${index + 1}`, 56, 112)
      const cover = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
      records.push({ id: `motion:book:${index}`, title: `Libro ${index + 1}`, name: `motion-${index}.pdf`, format: 'PDF', sourceType: 'local', mimeType: 'application/pdf', pageCount: 260,
        content: new Blob([bytes], { type: 'application/pdf' }), cover, coverFinish: index % 2 ? 'satin' : 'glossy', spineSurfaceFinish: index % 2 ? 'satin' : 'glossy',
        spineColorOverride: cols[Math.floor(index / 2)], shelfPosition: { shelf: Math.floor(index / 2), x: index % 2 ? .38 : .19 }, shelfOrder: index,
        addedAt: T0, lastOpenedAt: T0 - index, progressFraction: 0 })
    }
  } else {
    const pal = ['#18364b', '#713b42', '#375a46', '#5a4a1f', '#3b2f5c', '#7a3e1d', '#2f4858', '#8a2c3c'], finishes = ['glossy', 'satin', 'matte']
    const titles = ['Rayuela', 'Cien años de soledad', 'El Aleph', 'Pedro Páramo', 'Don Quijote', 'La sombra del viento', 'Ficciones', 'Los detectives salvajes', 'Platero y yo', 'Niebla',
      'Nada', 'Fortunata y Jacinta', 'La Regenta', 'Luces de bohemia', 'Bodas de sangre', 'El túnel', 'Conversación en La Catedral', 'Tiempo de silencio', 'Marianela', 'Campos de Castilla']
    for (let index = 0; index < count; index++) {
      const col = pal[index % pal.length]; let cover = null
      if (index % 7 !== 3) { // a few books keep the generated fallback jacket
        const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 600
        const context = canvas.getContext('2d'), g = context.createLinearGradient(0, 0, 400, 600); g.addColorStop(0, col); g.addColorStop(1, pal[(index + 3) % pal.length])
        context.fillStyle = g; context.fillRect(0, 0, 400, 600); context.fillStyle = '#e8e2cf'; context.font = '34px serif'; context.fillText(titles[index], 40, 110)
        context.fillStyle = index % 2 ? '#bd2739' : '#e0b84a'; context.fillRect(40, 300 + (index % 3) * 20, 320, 90)
        cover = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
      }
      const fin = finishes[index % 3]
      records.push({ id: `twenty:book:${index}`, title: titles[index], author: `Autor ${index % 7}`, name: `twenty-${index}.pdf`, format: 'PDF', sourceType: 'local', mimeType: 'application/pdf',
        pageCount: [90, 180, 260, 340, 420, 560, 720][index % 7], content: new Blob([bytes], { type: 'application/pdf' }), ...(cover ? { cover } : {}),
        coverFinish: fin, spineSurfaceFinish: finishes[(index + 1) % 3], spineColorOverride: col, shelfOrder: index,
        addedAt: T0, lastOpenedAt: T0 - index * 1000, progressFraction: 0 })
    }
  }
  await new Promise((resolve, reject) => { const tx = db.transaction('books', 'readwrite'); for (const r of records) tx.objectStore('books').put(r); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error) })
  db.close()
}

// ---- page helpers --------------------------------------------------------------------------------------------------
const SCENE = '.ihr-bookshelf-scene'
async function attrs(page) {
  return page.evaluate(() => { const c = document.querySelector('.ihr-bookshelf-scene'); if (!c) return null; const d = c.dataset
    return { a: d.animating, m: d.inspectionMoving, q: d.bookQualityPending, s: d.snapshotRenderCount, r: d.renderCount, c: d.inspectionCompositorFrames, v: d.viewProgress } })
}
// quietShelf() of shelf-motion-performance.spec.mjs, plus a stricter "nothing changed for ~1.2 s" test on both render counters.
async function quiet(page, label, timeout = 240000) {
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  const t0 = Date.now(); let last = null, stable = 0
  while (Date.now() - t0 < timeout) {
    const s = await attrs(page)
    const calm = s && s.a === 'false' && s.m === 'false' && (s.q === '0' || s.q === undefined)
    if (calm && last && last.s === s.s && last.r === s.r && last.c === s.c) { if (++stable >= 4) { await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); return } } else stable = 0
    last = s; await sleep(400)
  }
  throw new Error(`quiet(${label}): scene never settled ${JSON.stringify(last)}`)
}
// copied from shelf-motion-performance.spec.mjs gesture()
const gestureFn = async ({ frames, scale, panX = 0, panY = 0 }) => {
  const scroller = document.querySelector('.ihr-bookshelf__scroll'), scene = document.querySelector('.ihr-bookshelf-scene')
  const bounds = scene.getBoundingClientRect(), x = bounds.left + bounds.width / 2
  const y = bounds.top + Math.min(bounds.height, scroller.clientHeight) / 2, distance = 140
  const event = (type, id, dx, dy) => scroller.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: 'touch', pointerId: id, isPrimary: id === 1,
    clientX: dx, clientY: dy, buttons: type === 'pointerup' ? 0 : 1, pressure: .5 }))
  event('pointerdown', 1, x - distance / 2, y); event('pointerdown', 2, x + distance / 2, y)
  for (let index = 1; index <= frames; index++) {
    const progress = index / frames, spread = distance * (1 + (scale - 1) * progress), cx = x + panX * progress, cy = y + panY * progress
    event('pointermove', 1, cx - spread / 2, cy); event('pointermove', 2, cx + spread / 2, cy)
    await new Promise(resolve => requestAnimationFrame(resolve))
  }
  event('pointerup', 1, x + panX - distance * scale / 2, y + panY); event('pointerup', 2, x + panX + distance * scale / 2, y + panY)
  await new Promise(resolve => requestAnimationFrame(resolve))
  return { zoom: Number(scene.dataset.inspectionZoom), pan: scene.dataset.inspectionPan }
}
const visibleMiddleBookPointFn = () => {
  const scroller = document.querySelector('.ihr-bookshelf__scroll').getBoundingClientRect()
  for (const node of document.querySelectorAll('.ihr-spine[data-shelf-index="1"]')) {
    const rect = node.querySelector('[data-shelf-cover-hit]')?.getBoundingClientRect(); if (!rect) continue
    const left = Math.max(rect.left, scroller.left, 8), right = Math.min(rect.right, scroller.right, innerWidth - 8)
    const top = Math.max(rect.top, scroller.top + 8), bottom = Math.min(rect.bottom, scroller.bottom - 8, innerHeight - 8)
    if (right - left <= 12 || bottom - top <= 20) continue
    for (const fraction of [.5, .65, .35]) { const x = left + (right - left) * fraction, y = (top + bottom) / 2
      if (document.elementFromPoint(x, y)?.closest('.ihr-spine') === node) return { x, y, id: node.dataset.bookId } }
  }
  return null
}

// ---- state catalogue -------------------------------------------------------------------------------------------------
// A CHAIN is one fresh page load (cold SwiftShader start-up costs ~40 s, so loads are the expensive part) followed by
// an ordered list of steps; every step settles the scene and yields one screenshot named <step.id>-<390|1280>.png.
// Steps that continue on the same page only perform real user actions (tap, scroll, view switch), so the path taken is
// identical for baseline and candidate captures.
const switchView = async (page, mode) => {
  await page.locator(`.ihr-view-switch__button[data-view-mode="${mode}"]`).click()
  await page.waitForFunction(m => { const c = document.querySelector('.ihr-bookshelf-scene'); return c && c.dataset.viewProgress === (m === 'isometric' ? '1' : '0') && c.dataset.shelfView === m }, mode, { timeout: 180000 })
}
const scrollTo = async (page, fraction) => { await page.evaluate(f => { const s = document.querySelector('.ihr-bookshelf__scroll'); s.scrollTop = Math.round((s.scrollHeight - s.clientHeight) * f); s.dispatchEvent(new Event('scroll')) }, fraction) }
const lampTap = async (page, expectPower, vp) => { const l = page.locator('.ihr-lamp[data-lamp-id="tarnaby"]'); if (vp === 'mobile') await l.tap(); else await l.click(); await page.waitForFunction(p => document.querySelector('.ihr-lamp[data-lamp-id="tarnaby"]')?.dataset.lampPower === p, expectPower, { timeout: 60000 }) }
const zoomPinch = async page => {
  await page.evaluate(gestureFn, { frames: 4, scale: 1.8 }); await quiet(page, 'zoom-1')
  const r = await page.evaluate(gestureFn, { frames: 20, scale: 4 / 3, panX: 44, panY: 12 }); if (Math.abs(r.zoom - 2.4) > .01) throw new Error('unexpected zoom ' + r.zoom)
  await quiet(page, 'zoom-2'); await page.waitForFunction(() => Number(document.querySelector('.ihr-bookshelf-scene').dataset.highResolutionBooks) > 0, null, { timeout: 240000 })
  await page.waitForFunction(() => document.querySelector('.ihr-bookshelf-scene').dataset.inspectionCacheActive === 'false', null, { timeout: 120000 })
}
const flyout = async ({ page, vp }) => {
  const point = await page.evaluate(visibleMiddleBookPointFn); if (!point) throw new Error('no tappable middle-shelf book')
  if (vp === 'mobile') await page.touchscreen.tap(point.x, point.y); else await page.mouse.click(point.x, point.y)
  await page.locator('.ihr-flyout__cover-target').waitFor({ state: 'visible', timeout: 90000 })
  // "3D book at rest": opening class gone, flyout canvas attributes + pixels unchanged for ~1.6 s
  let last = null, stable = 0; const t0 = Date.now()
  while (Date.now() - t0 < 90000) {
    const sig = await page.evaluate(() => { const f = document.querySelector('.ihr-flyout'); const c = f?.querySelector('.ihr-flyout__book canvas'); if (!c) return 'nocanvas'
      let h = 0; try { const t = document.createElement('canvas'); t.width = 64; t.height = 96; const x = t.getContext('2d'); x.drawImage(c, 0, 0, 64, 96); const d = x.getImageData(0, 0, 64, 96).data; for (let i = 0; i < d.length; i++) h = (h * 31 + d[i]) | 0 } catch (e) { h = 'err' }
      return [f.className, c.dataset.angle, c.dataset.coverOpen, c.dataset.bookmarkWithdraw, h, f.dataset.openingPhase].join('|') })
    if (sig === last && !/is-opening-book/.test(sig) && sig !== 'nocanvas') { if (++stable >= 4) break } else stable = 0
    last = sig; await sleep(400)
  }
  if (stable < 4) throw new Error('flyout never settled: ' + last)
}
const closeFlyout = async page => { await page.getByRole('button', { name: 'Cerrar', exact: true }).click(); await page.waitForFunction(() => !document.querySelector('.ihr-flyout'), null, { timeout: 90000 }) }
const step = (id, act) => ({ id, act })
const CHAINS = [
  // The flyout is always the LAST step of its chain and is never closed: closing it re-inserts the book, which leaves book 3 in a
  // different pose and would contaminate any later step.
  { id: 'c1', lib: 'six', type: 'baggebo', view: 'isometric', theme: 'light', steps: [
    step('01-baggebo-iso-lamp-on-light'),
    step('03-baggebo-iso-lamp-off-light', async ({ page, vp }) => { await lampTap(page, '0.0000', vp) }),
    step('12-baggebo-iso-flyout-open-light', async ctx => { await lampTap(ctx.page, '1.0000', ctx.vp); await quiet(ctx.page, 'lamp-on'); await flyout(ctx) }) ] },
  { id: 'c9', lib: 'six', type: 'baggebo', view: 'isometric', theme: 'light', steps: [
    step('09-baggebo-iso-zoom24-pan-lamp-on-light', async ({ page }) => { await zoomPinch(page) }) ] },
  { id: 'c2', lib: 'six', type: 'baggebo', view: 'isometric', theme: 'dark', steps: [step('02-baggebo-iso-lamp-on-dark')] },
  { id: 'c3', lib: 'six', type: 'walnut', view: 'isometric', theme: 'light', steps: [step('08-walnut-iso-lamp-on-light')] },
  { id: 'c4', lib: 'six', type: 'baggebo', view: 'spine', theme: 'light', steps: [
    step('10a-baggebo-frontal-lamp-on-light'),
    step('10-baggebo-frontal-to-iso-light', async ({ page }) => switchView(page, 'isometric')),
    step('11-baggebo-iso-to-frontal-light', async ({ page }) => switchView(page, 'spine')) ] },
  { id: 'c5', lib: 'twenty', type: 'walnut', view: 'spine', theme: 'light', steps: [
    step('04-walnut-frontal-lamp-on-light-top'), step('05-walnut-frontal-lamp-on-light-mid', async ({ page }) => scrollTo(page, .5)) ] },
  { id: 'c6', lib: 'twenty', type: 'walnut', view: 'spine', theme: 'dark', steps: [
    step('06-walnut-frontal-lamp-on-dark-top'), step('07-walnut-frontal-lamp-on-dark-mid', async ({ page }) => scrollTo(page, .5)) ] },
  { id: 'c7', lib: 'twenty', type: 'baggebo', view: 'spine', theme: 'light', steps: [
    step('13-twenty-frontal-light'), step('14-twenty-iso-light', async ({ page }) => switchView(page, 'isometric')) ] },
  { id: 'c8', lib: 'heavy', type: 'baggebo', view: 'spine', theme: 'light', steps: [
    step('15-lamps4-frontal-light'), step('16-lamps4-iso-light', async ({ page }) => switchView(page, 'isometric')) ] }
]
// The walnut frontal states use the 20-book library so that the shelf actually scrolls (the 6-book shelf fits on one
// screen, so "mid scroll" would be identical to "top").

async function startServer(dist, port) {
  const logs = []
  const child = spawn(process.execPath, [path.join(REPO, 'node_modules/vite/bin/vite.js'), 'preview', '--outDir', path.resolve(dist), '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { cwd: REPO, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let exited = null; child.on('exit', c => { exited = c }); for (const s of [child.stdout, child.stderr]) s.on('data', d => logs.push(String(d)))
  const kill = () => { try { process.kill(-child.pid, 'SIGKILL') } catch {} try { child.kill('SIGKILL') } catch {} try { child.stdout.destroy(); child.stderr.destroy() } catch {} }
  process.on('exit', kill); for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { kill(); process.exit(130) })
  const url = `http://127.0.0.1:${port}/inhouse-read/`
  for (let i = 0; i < 120; i++) {
    if (exited !== null) throw new Error(`vite preview exited (${exited}): ${logs.join('').slice(-400)}`)
    try { const r = await fetch(url); if (r.ok) return { url, kill } } catch {}
    await sleep(500)
  }
  kill(); throw new Error('preview server did not start: ' + logs.join('').slice(-400))
}

async function capture() {
  const [dist, out, portArg] = positional(); const port = Number(portArg)
  if (!dist || !out || !port) { console.error('usage: capture <distDir> <outDir> <port>'); process.exit(2) }
  if (!existsSync(path.join(dist, 'index.html'))) { console.error('no index.html in ' + dist); process.exit(2) }
  const outDir = path.resolve(out), only = flag('only', null) && new RegExp(flag('only')), vpSel = flag('viewport', 'both')
  const workers = Math.max(1, Number(flag('workers', 3))), retries = Number(flag('retries', 1)), chainTimeout = Number(flag('timeout-s', 1800)) * 1000, paranoid = !!flag('paranoid', false)
  // jobs = (chain, viewport) pairs, restricted to the steps matching --only; the chain still replays the earlier steps.
  const jobs = []
  for (const chain of CHAINS) for (const vp of ['mobile', 'desktop']) { if (vpSel !== 'both' && vpSel !== vp) continue
    const names = chain.steps.map(s => `${s.id}-${VIEWPORTS[vp].tag}`); const wanted = names.filter(n => !only || only.test(n)); if (wanted.length) jobs.push({ chain, vp, names, wanted }) }
  const allNames = jobs.flatMap(j => j.wanted)
  if (flag('list', false)) { for (const n of allNames) console.log(n); return }
  await mkdir(outDir, { recursive: true })
  const { chromium } = await import(REPO + '/node_modules/playwright-core/index.mjs')
  const server = await startServer(dist, port); console.log(`serving ${path.resolve(dist)} at ${server.url}`)
  const pdf = (await readFile(path.join(REPO, 'tests/e2e/fixtures/tiny.pdf'))).toString('base64')
  const records = new Map(), failedSteps = new Map(), t00 = Date.now(), queue = [...jobs]
  const runChain = async (browser, job, wid) => {
    const { chain, vp } = job, lib = LIBS[chain.lib], tChain = Date.now(), problems = []
    const lap = l => { if (process.env.VIS_DEBUG) console.log(`    [w${wid}] ${chain.id}-${VIEWPORTS[vp].tag} ${l} +${((Date.now() - tChain) / 1000).toFixed(1)}s`) }
    const context = await browser.newContext({ ...VIEWPORTS[vp].opts, reducedMotion: 'reduce', colorScheme: 'light', locale: 'es-ES', timezoneId: 'UTC', serviceWorkers: 'block' })
    try {
      await context.route(u => !/^(https?:\/\/(127\.0\.0\.1|localhost)[:/]|data:|blob:)/.test(u.href), r => r.abort())   // Google Fonts etc: offline => identical fallback fonts
      await context.route('**/inhouse-read/__seed.html', r => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>seed</title>' }))
      await context.addInitScript(({ type, view, theme, plants, lamps }) => {
        // deterministic Math.random (mulberry32); the shelf itself does not use it but keys/ids may
        let a = 0x9e3779b9; Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 }
        try { localStorage.setItem('inhouse-read-theme', theme); localStorage.setItem('inhouse-read-shelf-view', view); localStorage.setItem('inhouse-read-shelf-type', type)
          localStorage.setItem('inhouse-read-shelf-plants', JSON.stringify(plants)); localStorage.setItem('inhouse-read-shelf-lamps', JSON.stringify(lamps)) } catch {}
      }, { type: chain.type, view: chain.view, theme: chain.theme, plants: lib.plants, lamps: lib.lamps })
      const page = await context.newPage(); page.setDefaultTimeout(240000)
      page.on('pageerror', e => problems.push('pageerror: ' + e.message.slice(0, 200)))
      page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::/.test(m.text())) problems.push('console: ' + m.text().slice(0, 200)) })
      await page.goto(server.url + '__seed.html')
      await page.evaluate(seedBooksInPage, { bytesB64: pdf, kind: chain.lib === 'twenty' ? 'twenty' : 'six', count: lib.books }); lap('seeded')
      await page.goto(server.url); await page.locator('.ihr-bookshelf').waitFor({ state: 'visible' })
      await page.waitForFunction(n => document.querySelectorAll('.ihr-spine').length === n, lib.books, { timeout: 180000 })
      await page.waitForFunction(({ type, p }) => { const c = document.querySelector('.ihr-bookshelf-scene'); return c && c.dataset.shelfType === type && c.dataset.viewProgress === p }, { type: chain.type, p: chain.view === 'isometric' ? '1' : '0' }, { timeout: 180000 })
      lap('view ok'); await quiet(page, 'initial'); lap('quiet')
      const lastWanted = Math.max(...job.wanted.map(n => job.names.indexOf(n)))
      for (let i = 0; i <= lastWanted; i++) {
        const st = chain.steps[i], name = job.names[i], tStep = Date.now(); let mark = problems.length
        try {
          if (st.act) { await st.act({ page, vp }); await quiet(page, 'after-act') }
          await page.mouse.move(0, 0)
          // a screenshot is accepted when the scene did not repaint while it was taken (and, with --paranoid, when two consecutive shots are identical)
          let shot = null, tries = 0, unstable = false
          for (; tries < 6; tries++) {
            const before = await attrs(page); shot = await page.screenshot({ animations: 'disabled', caret: 'hide' }); const after = await attrs(page)
            const same = JSON.stringify(before) === JSON.stringify(after) && before.a === 'false'
            if (same && (!paranoid || (await page.screenshot({ animations: 'disabled', caret: 'hide' })).equals(shot))) break
            await quiet(page, 'reshoot')
          }
          if (tries >= 6) { unstable = true; problems.push('screenshot never stabilised (6 tries)') }
          lap(`${name} shot`)
          const diag = await page.evaluate(() => { const c = document.querySelector('.ihr-bookshelf-scene'), s = document.querySelector('.ihr-bookshelf__scroll')
            return { scene: c ? { ...c.dataset } : null, canvas: c ? [c.width, c.height] : null, dpr: devicePixelRatio, inner: [innerWidth, innerHeight], theme: document.documentElement.dataset.theme,
              scroll: s ? { top: s.scrollTop, height: s.scrollHeight, client: s.clientHeight } : null,
              dom: { spines: document.querySelectorAll('.ihr-spine').length, lamps: document.querySelectorAll('.ihr-lamp').length, plants: document.querySelectorAll('.ihr-plant').length },
              gl: (() => { try { const g = document.createElement('canvas').getContext('webgl2'); const e = g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER) } catch { return null } })() } })
          await writeFile(path.join(outDir, name + '.png'), shot)
          const rec = { name, state: st.id, chain: chain.id, viewport: vp, lib: chain.lib, type: chain.type, initialView: chain.view, initialTheme: chain.theme, sha1: createHash('sha1').update(shot).digest('hex'), screenshotTries: tries + 1, unstable,
            problems: problems.slice(mark), stepMs: Date.now() - tStep, ...diag }
          await writeFile(path.join(outDir, name + '.json'), JSON.stringify(rec, null, 1)); records.set(name, rec); failedSteps.delete(name)
        } catch (e) { failedSteps.set(name, String(e.message).split('\n')[0].slice(0, 300)); console.log(`  [w${wid}] step ${name} failed: ${failedSteps.get(name)}`); throw e }
      }
    } finally { await context.close().catch(() => {}) }
  }
  const worker = async id => {
    const browser = await chromium.launch({ executablePath: CHROME_EXE, args: CHROME_ARGS })
    try {
      for (let job; (job = queue.shift());) {
        const t0 = Date.now(), want = () => job.wanted.filter(n => !records.has(n))
        for (let attempt = 0; attempt <= retries && want().length; attempt++) {
          try { await Promise.race([runChain(browser, job, id), new Promise((_, rej) => setTimeout(() => rej(new Error('chain timeout')), chainTimeout))]) }
          catch (e) { console.log(`  [w${id}] chain ${job.chain.id}/${job.vp} attempt ${attempt + 1} failed: ${String(e.message).split('\n')[0].slice(0, 220)}`) }
        }
        for (const n of job.wanted) if (records.has(n)) { const r = records.get(n); console.log(`  [w${id}] OK   ${n}  (step ${(r.stepMs / 1000).toFixed(1)}s)${r.unstable ? '  UNSTABLE' : ''}${r.problems.length ? '  problems: ' + r.problems.join(' | ') : ''}`) } else console.log(`  [w${id}] FAIL ${n}`)
        console.log(`  [w${id}] chain ${job.chain.id}/${job.vp} done in ${((Date.now() - t0) / 1000).toFixed(0)}s`)
      }
    } finally { await browser.close().catch(() => {}) }
  }
  try { await Promise.all(Array.from({ length: workers }, (_, i) => worker(i))) } finally { server.kill() }
  const done = allNames.filter(n => records.has(n)).sort(), failed = allNames.filter(n => !records.has(n)).sort()
  const all = {}; for (const f of readdirSync(outDir).sort()) if (f.endsWith('.json') && !/^(diagnostics|capture-report)/.test(f)) all[f.slice(0, -5)] = JSON.parse(readFileSync(path.join(outDir, f), 'utf8'))
  await writeFile(path.join(outDir, 'diagnostics.json'), JSON.stringify(all, null, 1))
  await writeFile(path.join(outDir, 'capture-report.json'), JSON.stringify({ dist: path.resolve(dist), port, totalSeconds: (Date.now() - t00) / 1000, captured: done, failed, failures: Object.fromEntries(failedSteps),
    unstable: done.filter(n => records.get(n).unstable), problems: Object.fromEntries(done.filter(n => records.get(n).problems.length).map(n => [n, records.get(n).problems])) }, null, 1))
  console.log(`\ncaptured ${done.length}/${allNames.length} states in ${((Date.now() - t00) / 1000).toFixed(0)}s -> ${outDir}`)
  console.log('captured: ' + done.join(', '))
  if (failed.length) { console.log('FAILED: ' + failed.join(', ')); process.exitCode = 1 }
  const unstable = done.filter(n => records.get(n).unstable); if (unstable.length) console.log('UNSTABLE (screenshot kept changing): ' + unstable.join(', '))
}

const cmd = argv[0]
if (cmd === 'capture') { await capture(); process.exit(process.exitCode || 0) }
else if (cmd === 'compare') await compare()
else { console.error('usage:\n  node visual.mjs capture <distDir> <outDir> <port> [--only regex] [--viewport mobile|desktop|both] [--workers N] [--list]\n  node visual.mjs compare <dirA> <dirB> [--out dir]'); process.exit(2) }
