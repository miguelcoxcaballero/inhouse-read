# Pruebas en local (WIP)

Ramas: `wip/mittled` (toque de la luz MITTLED a través de la estantería) y `wip/catalog`
(animación de cámara del catálogo IKEA, cierre rápido al poner un mueble, fluidez).
Ambas salen de `main` con trabajo a medias de un agente: pueden no compilar o tener tests rotos.

## Preparación
```bash
git fetch origin && git checkout wip/mittled   # o wip/catalog
npm ci
npx playwright install chromium
```

## 1. Unit tests (rápido)
```bash
npx vitest run --testTimeout=90000
```
Todo debe pasar. Relevantes: `tests/unit/catalog-preview-lifecycle.test.js`, `tests/unit/lamp-*.test.js`,
`tests/unit/bookshelf*.test.js`.

## 2. Build
```bash
npm run build
```

## 3. E2E (Playwright, GPU real de tu máquina)
```bash
# MITTLED / lámparas
npx playwright test tests/e2e/lamp-switches.spec.mjs tests/e2e/lamp-catalog.spec.mjs --reporter=line
# Catálogo
npx playwright test tests/e2e/plant-catalog.spec.mjs tests/e2e/shelf-types.spec.mjs --reporter=line
# Regresión general
npx playwright test tests/e2e/smoke.spec.mjs tests/e2e/offline-shell.spec.mjs --reporter=line
```
Fallo conocido de antes (no es de estas ramas): smoke "edita y conserva el color, fuente, tamaño y texto del lomo".

## 4. Pruebas a mano (`npm run dev`, abrir en el móvil o con emulación móvil 390x844)
MITTLED:
- Pon una lámpara MITTLED desde el catálogo. Tócala en vista frontal y en isométrica, también donde la tapa
  la madera de la estantería: debe encender/apagar al primer toque.
- Tocar un libro justo al lado debe seguir abriendo el libro, no la luz.
- Arrastrar la lámpara a otro sitio sigue funcionando; recargar conserva encendida/apagada.
Catálogo:
- Abrir el catálogo: la cámara viaja hacia el folleto hasta llenar la pantalla (~0,5 s), sin tirones.
- Cerrar: vuelve a la estantería con la animación inversa.
- Añadir una planta/maceta/lámpara: el catálogo se cierra al momento y el objeto aparece ya en la estantería.
- Desplazarse por la lista y cambiar de producto: fluido, previews 3D sin parones.
- Con "reducir movimiento" activado en el sistema, sin animación.
