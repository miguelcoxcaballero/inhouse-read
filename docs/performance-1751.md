# Rendimiento de 1.7.51

## Captura del gesto de cámara

Cuando las vistas fine y overview comparten exactamente el mismo frame, la
primera captura nueva del batch síncrono puede alimentar la segunda mediante
copia 2D. Se comprueban identidad del frame, contexto, revisiones y dimensiones.
Se conserva la revisión independiente de cada vista y no se persiste el recibo.
Los exports externos nunca reutilizan un canvas que pudo modificar su consumidor;
las vistas distintas, antiguas o de dimensiones diferentes conservan su captura.

No cambian geometría, texturas, materiales, sombras, DPR, resolución,
antialiasing, duración o límites de avance de la animación.

## Controles causales y visuales

Propuesta aislada: 21/21 unitarias, ocho nuevas y trece originales intactas.
El control exacto de 1.7.50 pasa 19 y conserva dos fallos nuevos por hacer dos
capturas GPU en lugar de una. Los casos de exportación modificada, revisiones
independientes, dimensiones, frames y respaldo pasan en ambas fuentes.
Certificado bajo `.animation.local/performance-1751/inspection-capture-proposal-attempt2/`,
`cpu-attempt1/summary.json`, SHA
`01169f94ac5e6ec31ac4a6e082b03c7cc1c523422bcc80533d68f2f3ff6e93a6`.

El primer método conserva FAILED: descubrió los trece originales pero ninguno
de los ocho nuevos debido a los separadores Windows del include. Su guard lo
detectó antes de lanzar el control. El segundo método utiliza rutas relativas
con slash; candidato y assertions tienen los mismos bytes.

El oráculo real compara ocho pares fine/overview a DPR 1,5 y 2:
64.341.600 componentes RGBA, cero diferencias; ocho PNG nativos exactos.
Utiliza los cuerpos literales de captura, binds y callsites de las dos fuentes,
con el mismo renderer, contexto, modelos, materiales, antialiasing y sombras
de 1.024. Incluye transparencia parcial, bordes, plantas y metales con relieve.
Cada batch pasa de dos capturas GPU a una captura y una copia 2D.
Los 32 PNG, 16 RGBA y 651 inputs mantienen sus hashes. Se inspeccionó la captura
de madera, libros y helecho. Certificado `inspection-capture-quality-attempt1/summary.json`,
SHA `bb42d6db0312151d62f9f86cc5a4610abf4712ea93422c2e39cc946ca61bbe96`.
No se infiere una mejora temporal ni un resultado en teléfono desde estos datos.

## Fuente final

Se adoptó únicamente la escena candidata, los ocho tests nuevos con adaptación
de imports por su ubicación en `tests/unit`, y la versión del paquete/footer.
La batería completa local pasa 2.865/2.865 unitarias en 211 archivos, build y
51 + 24 pruebas Python. Los 488 inputs permanecen intactos. Lista 524 identidades
E2E sin omisiones: esa enumeración no ejecuta los navegadores.
Evidencia `full-local-attempt1/summary.json` bajo `.animation.local/performance-1751/`.

Los siete recorridos originales locales pasan al primer intento, cero retries,
flaky u omitidos. Conservan las assertions y plazos originales, incluidos los
ocho segundos del cierre y treinta globales de los contratos nativos. Sus
cierres son 5.351,5 y 6.288,1 ms. El gesto original registra veinte composiciones,
cero nuevos renders de escena y dos escrituras de buffer; conserva geometrías,
texturas, programas y los seis libros a resolución 1.024. No se presenta una
diferencia entre ejecuciones como mejora temporal general.
Evidencia `local-browser-attempt1/summary.json` y sus métricas originales.

## Publicación comprobada

Fuente `3111b829e01f0e673f46667e206614abd133ffeb`, Pages
`8eb318358c95a167a5017fbcd05dae1001fa1046`; deploy original
`37229343991` SUCCESS. El entry HTTP real `main-CQlrLvyo.js` tiene
1.447.181 bytes y SHA
`c8624519414d2bce57cf18f6bf18b2f71c13803e02a5df4e6941b555104e6e64`.
Los 23 módulos y 44 recursos offline coinciden con el artefacto de Pages,
certificado HTTP `2b7b167a3f8d073f9b78192bbc2e17c456463bb2d0a6f4ff8f6ff30360275819`.

Pasan tres recorridos de editor/regreso y los 18 PDF originales publicados,
una ejecución por caso, sin retries, flaky ni omisiones. Se contrastan
50 + 308 cuerpos HTTP y se conservan 15 capturas PDF. Certificados
`41d2949a16cab859b9633ee90ebd294e22ecf62a91b3bbf9ab80b9d151004691`
y `f962811d492fa25a7cc808573898c8c2e333b4c7ab4e7dbdba645bc288e5b324`.
Las assertions y los plazos originales se conservan. Las comprobaciones de
narración PDF utilizan un motor controlado explícito para revisar posiciones;
los motores naturales conservan su comprobación original separada en CI.

La APK descargada de nuevo sigue siendo la firmada 1.1.4, código 17:
78.515.243 bytes, SHA
`feafaaa762b35344ac8b19418f9f6eb6cb1f725fba22b1ef3d3f273bd32a6191`.
Contiene sólo el loader de 2.089 bytes y dos stubs vacíos. El loader coincide
con la fuente, SHA
`8e03c3a6c8f840d9e9cf66637babe2d63742d2948d852534b865db0086aa9f34`.
Certificados APK
`1eb679a23a6f76ed7beb714616c95523cbaec8a2733abe04ec72e6515d1ef919`
y loader `d0b82f95d3ce654277e4df60aebfd4d8ba1e902082cbf6e4a40e698357a09692`.
Son bytes descargados de esta publicación, sin captura nativa nueva ni
atribución de un nuevo build Android.

La CI original `37229344015`, vinculada a la fuente 3111b82, conserva FAILURE
en UI3: cuarenta casos, 38 expected y dos unexpected; 42 intentos, cuatro
timedOut y dos retries. Los cuatro intentos nativos llegan al PDF visible
dentro de su espera original de ocho segundos: 7.813, 7.563, 7.728 y 7.722 ms
en el reloj backend de la traza. Después pulsan `reader-back`, pero el límite
global original de treinta segundos interrumpe la espera del cierre. Las
esperas registradas al corte duran 6.886, 7.116, 7.520 y 5.755 ms: son
intervalos truncados; no prueban el fin real ni el cumplimiento o incumplimiento
del gate completo de ocho segundos. No se infiere un instante desde snapshots
tardíos que no existen. Los logs/ZIP originales y lectura de trazas quedan en
`failure-ui3-3111b82-first-early/`. La CI completa terminó **FAILED**.
Sus 2.865 unitarias en 211 archivos pasan; 524 E2E contienen 522 expected y
dos unexpected, cero flaky u omisiones. Los 526 intentos incluyen cuatro
timedOut y dos retries. Sólo UI3 falla; los otros diez grupos, incluidas las
220 comprobaciones Supertonic, pasan. Se conservan doce logs y once ZIP
originales con digests y miembros verificados, sin incidencias en la recogida.
Certificado `ci-3111b82-failed-original-collector-attempt1/snapshot-001/certification.json`,
SHA `b480228970f54b917bc570916abd9d82415e38d335fccd2dd6cc268fe2d5fa49`.
Se conservan los fallos de 1.7.50:
sus cuatro intentos nativos de CI quedan en la fase de apertura `zooming`,
con el PDF ya preparado pero oculto. El cierre no llegó a ejecutarse.
Los controles locales y públicos no sustituyen esa CI. No se ha medido
temperatura, batería o fluidez de un teléfono físico.
