# Rendimiento de web 1.7.50

## Cambios

La devolución consume la lista pendiente antes de pintar la estantería final.
El libro y su propietario nativo siguen vivos durante esa pintura: el canvas
se entrega a la estantería antes de disponer el modelo o retirar el flyout.
Sin una lista pendiente, el flush conserva la pintura necesaria. La cancelación
mantiene su secuencia anterior. El foco se resuelve sobre el nodo que queda
después de aplicar la lista.

Cuando cambian simultáneamente el tamaño y el DPR de un framebuffer nativo,
se usa `setDrawingBufferSize` de Three 0.180.0. Se evita crear primero un
buffer con las dimensiones lógicas anteriores y la escala nueva. Se mantienen
el tamaño físico final, su redondeo, viewport, CSS y contexto. Las capturas
legadas, XR, renderizadores sin esa API y los cambios de una sola magnitud
conservan la secuencia previa. No cambian los materiales, geometría, luces,
resolución de texturas, DPR ni relojes de animación.

## Controles causales

La propuesta aislada de pintura pasa 30/30 casos: cuatro nuevos y 26 originales.
El control exacto de 1.7.49 pasa 29 y falla uno por las dos pinturas finales
frente a una. Transferencia, cancelación, foco y el flush sin cola pasan en
ambas fuentes. El primer método conserva sus resultados separados: contenía
un guard nuevo que exigía que la primera transferencia apuntara al stage final,
aunque una transferencia segura podía preceder a su sustitución. La revisión
usa la última transferencia para comprobar el stage final, conservando la
exigencia de transferir antes de disponer.

La propuesta de tamaño pasa 102/102 casos, incluidos 92 originales intactos
y diez nuevos a través de la caché real. El driver modela la API instalada,
su redondeo y la protección XR. En el control original, el log registra 98
aprobados y cuatro fallos nuevos por las asignaciones intermedias. Su wrapper
PowerShell terminó con `NativeCommandError` antes de guardar el JSON y recibo
final: no se inventan estos datos ni se repite la batería para sustituirlos.
El error inicial de preparación de Python también queda conservado aparte,
sin haber editado runtime ni ejecutado pruebas.

Las propuestas y hashes están en
`.animation.local/performance-1749/final-paint-proposal-attempt2/` y
`.animation.local/performance-1750/atomic-renderer-size-proposal-attempt2/`.
Los mocks demuestran orden y asignaciones; no miden latencia del driver GPU.

## Fuente final

La primera batería completa conserva FAILED: 2.856/2.857 pruebas unitarias.
Su único fallo original detectó que el paquete era 1.7.50 y el footer mostraba
1.7.49. Se corrigió el footer real sin cambiar la assertion. La revisión tiene
su propia batería y evidencia en `footer-revision.json`.

La revisión final pasa 2.857/2.857 unitarias en 210 archivos, build y las 51 + 24
comprobaciones Python. Su lista contiene 524 identidades E2E únicas, sin omisiones:
la lista no ejecuta los navegadores. Los 487 inputs de runtime, pruebas y
configuración conservan sus bytes durante la ejecución; la documentación está
excluida. Evidencia `full-local-attempt2/summary.json` bajo
`.animation.local/performance-1750/`.

El build local final produce `main-DBnKLkYN.js`, 1.446.628 bytes, SHA-256
`897ed15495eb933a026eed04be9638893b8af5a00085986f21c98296c3364567`.

Los siete recorridos originales pasan al primer intento, con un worker,
cero retries, flaky, omisiones o errores. Comprueban continuidad entre vecinos,
cancelación de viewport, editor móvil, respaldo sin WebGL, los dos contratos
nativos y el gesto isométrico. Los cierres registran 4.524,1 y 6.168,7 ms,
con el límite original de ocho segundos y global de treinta. Se conservan
fuente, build, fixtures y assertions originales. Certificado
`local-browser-attempt1/summary.json`, SHA
`9becd0e0ed6e3e9ef38eba4240e7f03c517ff957a6191602441230b58d37fc87`.
La diferencia con otra ejecución no se presenta como mejora general de latencia.

El oráculo de tamaño atómico pasa cuatro comparaciones al primer intento:
portada y lomo, a DPR 2 y 1,5. Compara 32.098.560 componentes RGBA, exportaciones
2D completas y PNG nativos, todos exactos. Cada pareja utiliza el mismo
renderizador, contexto, modelo, materiales y antialiasing. En los cambios reales
390 × 784 a DPR 1,5 ↔ 390 × 845 a DPR 2, las asignaciones de anchura y altura
bajan de dos a una por magnitud; el resultado, viewport y CSS son iguales.
Certificado `atomic-size-quality-attempt1/summary.json`, SHA
`a74f02eea6107ced918424d42bda91de6bb7ac8a5c6ba755243085b12c1ed300`.
Se inspeccionó la captura de portada y marcapáginas. Es una comprobación con
SwiftShader en escritorio; no mide la velocidad de un teléfono.

## Publicación real

Fuente `bfbd2e3f2735a6fe63b3ba4a79e5ee544ec7d864`, deploy 37227762665 SUCCESS,
Pages `4c14733aad1d42c4811cea9b712000ec5e89e80e`. El primer pin conserva FAILED:
el CDN todavía devolvía el HTML anterior. El segundo pin tiene su namespace
propio y compara bytes HTTP con el commit de Pages, sin relajar la comprobación.

La web sirve `main-CysGYWYS.js`, 1.446.626 bytes, SHA
`c18c5e760c97476a3ba11c549e539ae9403b0c0a84eb3aa1828bacad45b47590`.
Sus 23 módulos y 44 recursos offline coinciden exactamente con Pages. El build
publicado tiene identidad propia; no se confunde con el build local anterior.
Evidencia bajo `.animation.local/performance-1750/public-bfbd2e3-attempt2/`:

- HTTP `http-attempt1/artifact-1750-bfbd2e3.json`, SHA
  `c0762a99c5ad728e13793b0a995ffc05bf8c50ff5bc2a10019d8ce758d9627a0`.
- Editor móvil y dos regresos nativos: 3/3 al primer intento, cero retries,
  50 cuerpos HTTP reales comprobados. Certificado
  `performance-browser-attempt1/performance-qualification.json`, SHA
  `c0b59cd077176a8cfb09c080a8df7aa36c2ef7be70cedc4c9c80e3faef6a21b9`.
- PDF: 18/18 al primer intento, cero retries, 310 cuerpos HTTP y 15 capturas.
  Certificado `browser-attempt1/certification.json`, SHA
  `f390f21808f5d96a791835e316447a498ced4772ac3491551f308cb1a61db5a3`.
  Se inspeccionó la captura AMOLED: conserva las imágenes RGB y el texto completo.
- Descarga nueva del APK 1.1.4, código 17: 78.515.243 bytes, SHA
  `feafaaa762b35344ac8b19418f9f6eb6cb1f725fba22b1ef3d3f273bd32a6191`.
  Su loader de 2.089 bytes coincide con la fuente y conserva únicamente éste
  y dos stubs Cordova vacíos en `assets/public`. Certificados
  `apk-attempt1/public-apk.json` y `apk-attempt1/apk-loader.json`, SHA
  `9ee4506b09698c7ff80a3706be6033093485c200223c008b728de40ad4cb9214` y
  `db0f5f2fdc9c0b20d07c01d1c53d2783c45aa5d8f612fd5bd7f9427b6570595c`.

El job original UI3 de CI 37227762667 conserva FAILURE: cuarenta casos,
38 expected y dos unexpected, 42 intentos, cuatro fallos y dos retries.
Los cuatro intentos nativos no llegaron a `reader-back`: la espera original
de ocho segundos encontró el PDF preparado pero oculto, con la transición
en `zooming` (coverOpen y bookmarkWithdraw 1; pageTheme 0,972). El informe
finaliza por timeout global de treinta segundos. Estos datos localizan la
apertura; no se atribuyen al gate del cierre. Assertions y plazos son los
mismos de 1.7.49. Log y ZIP originales quedan en
`failure-ui3-bfbd2e3-first-early/` bajo el namespace de esta versión.

La CI original completa 37227762667 conserva **FAILED**: 2.857 unitarias
en 210 archivos pasan; los 524 casos E2E originales contienen 522 expected,
dos unexpected y cero flaky u omisiones. Sus 526 intentos incluyen
522 passed, cuatro timedOut y dos retries. Los otros diez grupos originales
pasan; sólo UI3 falla y el aggregate conserva FAILURE. Se contrastan los doce
logs y once ZIP autenticados, sus digests y miembros, con un censo único de
las 524 identidades. Certificado
`ci-bfbd2e3-failed-original-collector-attempt1/snapshot-001/certification.json`,
SHA `b3d2b9afc6095f529d843385fa5b6bac065a82962e633453ae008ab27159dcab`.
Ningún resultado local o público sustituye ese control ni los fallos originales
de 1.7.49. No se ha medido temperatura, batería o fluidez de un teléfono físico.
