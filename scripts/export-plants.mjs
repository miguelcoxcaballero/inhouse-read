/**
 * Exporta las macetas de `scripts/lib/plant-svg.mjs` como ficheros .svg sueltos en
 * `assets/plants/`, para poder usarlas fuera del componente (splash, README,
 * ilustraciones) sin duplicar los dibujos.
 *
 * La fuente de verdad es siempre plant-svg.mjs: estos ficheros son un derivado.
 * Regenerar con:  node scripts/export-plants.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { PLANT_VARIANTS, plantSvg } from './lib/plant-svg.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', 'assets', 'plants')

await mkdir(outDir, { recursive: true })

for (const variant of PLANT_VARIANTS) {
  // Semilla = nombre de la variante: el fichero suelto sale siempre igual.
  const svg = plantSvg(variant, { seed: variant, standalone: true })
  const file = join(outDir, `${variant}.svg`)
  await writeFile(file, `${svg}\n`, 'utf8')
  console.log(`escrito assets/plants/${variant}.svg (${svg.length} bytes)`)
}
