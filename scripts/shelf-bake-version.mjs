// Saved shelf bakes (src/js/shelf-bake-cache.js) are valid only for the code that made them. A production build defines
// __SHELF_BAKE_VERSION__ as a hash of the plant and lamp generators, every module of ours they import (transitively)
// and the three.js release, so a release that leaves them alone keeps the bakes, and any change regenerates them once.
// 'vite dev' defines null: sources change under a running server, and the bakes are then never read or written.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'

export const SHELF_BAKE_GENERATORS = ['src/js/shelf-plants.js', 'src/js/shelf-lamps.js']
// The plants' geometry is drawn by the Rust shelf module. Its compiled bytes and its generated glue change with every
// unrelated feature of that module (and the bytes between two builds of the same source), so the hash follows the sources
// of the geometry itself, not the module, and keeps bakes across releases that leave them alone.
export const SHELF_BAKE_RUST_SOURCES = ['rust-ui/src/plant_model.rs', 'rust-ui/src/plant_parts.rs', 'rust-ui/src/three_geo.rs', 'rust-ui/src/three_curve.rs',
  'rust-ui/src/three_math.rs', 'rust-ui/src/three_shape.rs', 'rust-ui/src/earcut.rs', 'rust-ui/src/geo_packet.rs', 'rust-core/src/jsmath.rs']
const shelfModuleFile = file => /[\\/]src[\\/]js[\\/]rust-shelf\.js$|[\\/]src[\\/]wasm[\\/]shelf[\\/]/.test(file)

export function shelfBakeHash(root) {
  const digest = createHash('sha256'), seen = new Set()
  const visit = file => {
    if (seen.has(file) || shelfModuleFile(file)) return
    seen.add(file)
    const bytes = readFileSync(file)
    digest.update(relative(root, file)).update('\0').update(bytes).update('\0')
    // Vite asset imports include ?url/?raw. Hash the exact file bytes, not
    // a filename containing that query, and never parse binary data as JS.
    if (!['.js', '.mjs', '.cjs'].includes(extname(file))) return
    const source = bytes.toString('utf8')
    for (const [, specifier] of source.matchAll(/\b(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
      visit(resolve(dirname(file), specifier.split(/[?#]/, 1)[0]))
    }
  }
  for (const generator of SHELF_BAKE_GENERATORS) visit(join(root, generator))
  for (const source of SHELF_BAKE_RUST_SOURCES) {
    const file = join(root, source)
    if (existsSync(file)) digest.update(source).update('\0').update(readFileSync(file, 'utf8').replaceAll('\r\n', '\n')).update('\0')
  }
  const three = JSON.parse(readFileSync(join(root, 'node_modules/three/package.json'), 'utf8')).version
  return digest.update(`three@${three}`).digest('hex').slice(0, 20)
}

export function shelfBakeVersion(root) {
  return {
    name: 'inhouse-shelf-bake-version',
    config: (_, { command }) => ({ define: { __SHELF_BAKE_VERSION__: JSON.stringify(command === 'build' ? shelfBakeHash(root) : null) } })
  }
}
