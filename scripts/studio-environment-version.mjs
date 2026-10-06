// Keep an identical half-float studio atlas across unrelated app releases.
// Include the immutable studio renderer and its local dependencies, plus
// the actual Three build and the cache contract. Changed inputs bake again.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

export const STUDIO_INPUTS = ['scripts/studio-environment-version.mjs',
  'src/js/studio-renderer.js', 'src/js/studio-environment-cache.js']
export const THREE_INPUTS = ['node_modules/three/package.json',
  'node_modules/three/build/three.core.js', 'node_modules/three/build/three.module.js']

export function studioEnvironmentHash(root) {
  const digest = createHash('sha256'), seen = new Set()
  const visit = file => {
    if (seen.has(file)) return
    seen.add(file)
    const source = readFileSync(file, 'utf8').replaceAll('\r\n', '\n')
    digest.update(relative(root, file).replaceAll('\\', '/')).update('\0').update(source).update('\0')
    for (const [, specifier] of source.matchAll(/\b(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
      visit(resolve(dirname(file), specifier))
    }
  }
  for (const input of [...STUDIO_INPUTS, ...THREE_INPUTS]) visit(join(root, input))
  return digest.digest('hex').slice(0, 20)
}

export function studioEnvironmentVersion(root) {
  return {
    name:'inhouse-studio-environment-version',
    config:(_, { command }) => ({ define:{ __STUDIO_ENVIRONMENT_VERSION__:
      JSON.stringify(command === 'build' ? studioEnvironmentHash(root) : null) } })
  }
}
