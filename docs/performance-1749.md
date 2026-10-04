# Rendimiento de web 1.7.49

## Cambios

La devolución puede conservar el modelo que abrió el lector aunque la portada
PDF haya recibido una imagen HD o el cálculo del grosor difiera únicamente por
ruido de coma flotante. La vía es explícita: `signature` y `take` mantienen su
rechazo estricto anterior. La nueva comparación normaliza a 14 cifras
significativas sólo la clave de ancho, alto, grosor y centro. No modifica los
vértices, las dimensiones que se renderizan ni los transforms.

Las propiedades del libro que determinan su identidad y acabados permanecen
estrictas. También el viewport, el aspect ratio y cualquier propiedad
estructural desconocida del estilo. La actualización incremental admite sólo
`color`, `shade`, `ink`, `fontFamily`, `fontCanvasFamily`, `fontFallback`,
`fontWeight` y `appearanceSource`. El mismo modelo recibe la nueva cubierta y
su apariencia antes del primer frame de cierre. Si tiene relieve, espera su
preparación. Conserva página, tema, marcapáginas y programas. Un fallo, un
modelo pendiente o un cambio incompatible dispone ese modelo oculto y emplea
la creación habitual de una vista nueva. Destruir o sustituir el propietario
invalida también el préstamo async pendiente.

Al pulsar Back se cancela la extracción HD opcional antes de preparar la
página de devolución. Se conservan el reader y epoch originales en el
controlador; el PDF cancela el RenderTask real y retira su listener en finally.
Una respuesta que termine después de cancelar, cerrar o sustituir el lector
no provoca una nueva solicitud de guardado ni un refresco de estantería. El
raster conserva los límites anteriores de 1200/1600 px y 3×, y JPEG 0.9.

Se mantienen geometría, materiales, luces, DPR, resolución y relojes de
animación. Los plazos originales de los contratos nativos son 30 segundos
para el caso y 8 segundos para el cierre.

## Evidencia previa de 1.7.48

La CI original 37221277939 conserva FAILED: sus dos contratos nativos fallan
el plazo original de 8 segundos en ambos intentos. El resto del censo contiene
522 expected, dos unexpected, cero flaky y cero omitidos; no se sustituye ese
resultado por las pruebas locales o públicas que sí pasaron.

Un observador aislado de la fuente 1f8f00e pasa los dos casos nativos locales,
sin retries. Registra 5607 ms y 6110 ms de cierre, con los plazos intactos.
Es diagnóstico: hubo una ejecución CPU concurrente al principio y no acredita
la velocidad del CI ni de un teléfono. La portada HD ya había completado su
render/encode/commit antes de Back en ambos fixtures. La cancelación no
elimina una portada ya guardada. No se creó un studio/PMREM nuevo durante el
cierre. El modelo se recreó, con valores de grosor
13.827272727272724 y 13.827272727272726 en el caso alineado; la URL de cubierta
había cambiado. Las mayores pausas registradas estaban entre frames, con
costes en zoom y devolución. La fuente observada permanece separada de la
aplicación publicada.

## Regresiones y controles de CPU

La propuesta aislada de reutilización pasa 68/68 casos en siete archivos:
41 casos originales y 27 nuevos. Sobre runtime exacto de la fuente 1.7.48,
los mismos 68 casos producen 42 pass y 26 fail. Los 41 originales pasan en
ambas fuentes; también pasa el fallback ya existente. Los nuevos casos que
requieren la API y el flujo compatible fallan en ese control. No hay casos
pendientes ni timeouts y los archivos originales conservan sus bytes.

La propuesta de cancelación pasa 80/80 casos. Su control original 1.7.48
conserva 12 fallos de assertions y un caso de calidad que pasa, sobre los 13
casos nuevos. La revisión posterior cambia sólo indentación del cuerpo PDF
y pasa los mismos 80 casos una vez; no vuelve a ejecutar el control original.

La revisión 1 completa pasó 2842 unidades en 208 archivos y el build, pero
una revisión posterior detectó un defecto real: la actualización fusionaba
el progreso antes de comparar el estado del marcapáginas. Podía mantener la
geometría anterior de la cinta y de las hojas leídas. Esos resultados y su fuente
se conservan; no acreditan la revisión final.

La revisión 2 actualiza el marcapáginas antes de fusionar el registro, con el
primer dibujo todavía diferido. Pasa 69/69 casos enfocados en siete archivos.
La misma prueba nueva y la misma fixture, sobre la revisión 1, pasan 68 casos
y fallan uno por la geometría desactualizada de ambos elementos. La prueba
compara todos los atributos de geometría y los materiales con un modelo
fresco del mismo ID, página, pose y portada HD, con progreso .21→.73; además
comprueba que la preparación no dibuja. Los 41 casos originales permanecen
byte idénticos. En el test nuevo anterior de conservación se corrigió sólo
el input para indicar el progreso .5 que ya esperaba, manteniendo todas sus
assertions.

Se conserva toda la evidencia bajo `.animation.local/performance-1749/`:
`adoption-attempt1/summary.json`, `return-reuse-proposal-attempt1/cpu-summary.json`
y `cover-close-proposal-attempt2/summary.json`. El perfil diagnóstico está en
`.animation.local/performance-1748/close-observer-attempt2/gpu-attempt1/summary.json`.
La prueba causal de revisión 2 está en
`return-reuse-proposal-attempt2/cpu-summary.json`, con sus dos primeras
ejecuciones y la fuente y los resultados de revisión 1 preservados.

## Cualificación de la fuente final

La primera batería completa de la revisión final pasa 2.843/2.843 unitarias
en 208 archivos, sin fallos, pendientes ni todo; build y las 51 + 24
comprobaciones Python originales. El censo enumera 524 casos E2E únicos, sin
omisiones: `--list` no los ejecuta. Los 484 archivos de runtime, pruebas y
configuración mantienen sus hashes antes y después, excluyendo documentación.
El único delta desde la revisión 1 es el modelo y su nueva regresión.

El build local produce `main-CmolX6Vw.js`, 1.446.558 bytes, SHA-256
`70f95b6c8d61691776759a3fc1293c2362bda0a05695883a0204efbf7aa8f019`.
Resumen `.animation.local/performance-1749/full-local-attempt2/summary.json`,
SHA `35f34478ea689a06d55d0e69f7916222d384c6cf88695d23758f9cb8e5a29f64`.
El build y los resultados de la revisión 1 permanecen separados.

Los siete recorridos originales pasan en su primera ejecución, con un worker
y cero reintentos, flaky, omisiones o errores. Incluyen devolución entre
vecinos, cancelación al cambiar viewport, editor, respaldo sin WebGL, dos
contratos nativos y gesto isométrico. Los cierres nativos registran 5.405,7 ms
y 5.235,3 ms, con límite original de 8.000 ms y global de 30 segundos. El
gesto conserva dos escrituras del buffer y cero repintados GPU de la escena
en sus veinte frames de composición. Fuente, métodos y build permanecen
idénticos antes y después. Resumen `local-browser-attempt1/summary.json`,
SHA `03bcae93c06b90a84c28d958cc006aeb79fc043af29a095ca145a8b4980aa1c0`.

## Calidad de la vista reutilizada

El tercer método conserva la misma fixture, el bucle de captura y sus
assertions, y pasa las 30 comparaciones: tres acabados, cinco poses y DPR 2
y 1.5. Compara la vista retenida de la revisión 2 con un modelo fresco del
mismo libro y apariencia final sobre el runtime 1.7.48. Usa páginas y portada
HD de un PdfReader real, fuentes WOFF2 guardadas y el mismo progreso,
marcapáginas, tema y relieve. Todos los componentes RGBA son idénticos y los
pares de PNG del compositor tienen los mismos bytes. Se conservan 60 buffers
RGBA y 120 PNG, con 484 inputs de fuente y 697 hechos fijados sin cambios.
No es una medida de tiempo de animación.

Los dos métodos anteriores de servidor dev permanecen FAILED por carga a
30 segundos, con cero poses o componentes comparados. El tercer método
emplea un único build de la fixture; no amplía los plazos ni cambia los
oracles. Resumen `return-appearance-quality-attempt3/summary.json`.

## Web y APK publicadas

La fuente publicada es `1d47968071b7b95533ca4bb3bf2c1f4c26bc9d05` y Pages
`a0f79a74691edc3227d725fa0fedf5f29be775d9`. Se verifican los bytes HTTP del
grafo de 23 módulos y las 44 entradas offline contra ese artefacto Git. El
main real es `main-DIIMdC6h.js`, 1.446.556 bytes, SHA-256
`6df165691abe4703ccb8cbc8dfc2d824d64f7b1d8e3bcba355e95580d6504fdc`.

Los 18 recorridos PDF públicos pasan una vez, con 310 cuerpos HTTP exactos
y 15 capturas. Los tres recorridos públicos originales de editor y regreso
nativo también pasan, sin retries y con 50 cuerpos HTTP exactos. Se mantienen
sus assertions y plazos originales. Una observación pública separada añade
sólo un MutationObserver y registra `data-return-view="reused"` en el caso
alineado; no establece qué vista usó el CI ni una mejora de velocidad.

La APK firmada existente Android 1.1.4 se descarga nuevamente: 78.515.243
bytes, SHA-256
`feafaaa762b35344ac8b19418f9f6eb6cb1f725fba22b1ef3d3f273bd32a6191`.
Su loader de 2.089 bytes coincide con la fuente Git; abre la web remota.
Estas verificaciones no acreditan una captura nueva en un teléfono físico.
La evidencia permanece en `public-1d47968-attempt1/`: `pins.web-1d47968.json`,
`http-attempt1`, `apk-attempt1`, `browser-attempt1`,
`performance-browser-attempt1` y `passive-return-observer-attempt1`.

## CI original

La CI original 37224970834, de la fuente publicada 1d47968, conserva
**FAILED**. Pasan 2.843 unitarias en 208 archivos. El censo original completo
incluye 524 casos E2E únicos: 522 expected, dos unexpected, cero flaky y cero
omitidos. Los 526 intentos conservan 522 pases, cuatro fallos y dos retries.
Sólo UI3 falla; los otros diez jobs de pruebas pasan y el agregador falla.
Los dos contratos nativos fallan `not.toHaveClass(/is-closing-reader/)` con
timeout de 8.000 ms en ambos intentos. Sus assertions y plazos son idénticos
a los de la fuente 1.7.48; no se ha vuelto a ejecutar el CI.

Se conservan los doce logs y once ZIP originales autenticados, con tamaños,
SHA-256, CRC y hashes de sus miembros extraídos, junto al guard UI exacto de
Git 1d47968. Evidencia `ci-1d47968-failed-original-collector-attempt1/snapshot-001/`;
certificado `certification.json`, SHA-256
`174014dbd68d8dcf0228d654a9146b7c9e44683ec7f76046b295776f5b8e94a6`.
El censo de este collector procede de los diez manifests originales
subidos al CI; no se presenta como un nuevo `--list` de una exportación
inmutable. El listado local de la revisión 2 sigue separado.

Los cuatro traces sí completan el expect backend de ocho segundos; no son
los timeouts globales truncados que aparecieron en 1.7.47. Los snapshots
posteriores ya muestran la estantería restaurada, pero se tomaron después
del plazo fallido. El observador de la página no se leyó al fallar la primera
assertion, por lo que no se conocen `clickedAt` ni `endedAt`. Los snapshots
no incluyen `data-return-view`, fase ni progreso durante la espera. Los
frames visuales muestreados no permiten asignar límites exactos a las fases
ni convertir el fallo en PASS. Se conserva el log y ZIP autenticados en
`failure-ui3-1d47968-first-early/`, sin sustituir el collector final.

No se afirma una mejora temporal de 1.7.49. Los resultados locales y públicos
no sustituyen el fallo original del CI. No se han medido temperatura,
batería ni fluidez en un teléfono físico.
