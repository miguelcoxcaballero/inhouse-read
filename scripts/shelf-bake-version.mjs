// Saved shelf bakes (src/js/shelf-bake-cache.js) are valid only for the code that made them. A production build defines
// __SHELF_BAKE_VERSION__ as a hash of the plant and lamp generators, every module of ours they import (transitively)
// and the three.js release, so a release that leaves them alone keeps the bakes, and any change regenerates them once.
// 'vite dev' defines null: sources change under a running server, and the bakes are then never read or written.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

export const SHELF_BAKE_GENERATORS = ['src/js/shelf-plants.js', 'src/js/shelf-lamps.js']

export function shelfBakeHash(root) {
  const digest = createHash('sha256'), seen = new Set()
  const visit = file => {
    if (seen.has(file)) return
    seen.add(file)
    const source = readFileSync(file, 'utf8')
    digest.update(relative(root, file)).update('\0').update(source).update('\0')
    for (const [, specifier] of source.matchAll(/\b(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) visit(resolve(dirname(file), specifier))
  }
  for (const generator of SHELF_BAKE_GENERATORS) visit(join(root, generator))
  const three = JSON.parse(readFileSync(join(root, 'node_modules/three/package.json'), 'utf8')).version
  return digest.update(`three@${three}`).digest('hex').slice(0, 20)
}

export function shelfBakeVersion(root) {
  return {
    name: 'inhouse-shelf-bake-version',
    config: (_, { command }) => ({ define: { __SHELF_BAKE_VERSION__: JSON.stringify(command === 'build' ? shelfBakeHash(root) : null) } })
  }
}
