import { readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const assetsDirectory = join('dist', 'assets')
const assets = await readdir(assetsDirectory)
const currentPdfReader = assets.find(file => /^pdf-reader-[\w-]+\.js$/.test(file))

if (!currentPdfReader) {
  throw new Error('No se encontró el módulo PDF generado por Vite.')
}

// Android puede conservar en caché una versión antigua de la app cuyo
// import dinámico apunta a este nombre exacto. Reexportar la implementación
// actual repara esas instalaciones sin duplicar el bundle de PDF.js.
const legacyPdfReader = 'pdf-reader-F60yyvDC.js'
await writeFile(
  join(assetsDirectory, legacyPdfReader),
  `export { PdfReader } from './${currentPdfReader}'\n`,
  'utf8'
)

console.log(`Compatibilidad PDF: ${legacyPdfReader} → ${currentPdfReader}`)
