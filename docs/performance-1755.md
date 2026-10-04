# Rendimiento de 1.7.55 — preparación del regreso

## Trabajo gráfico oculto evitado

La devolución exacta de un modelo conservado actualizaba el marcapáginas
antes de instalar su página reciente. Cuando cambiaba la cinta, esa actualización
dibujaba la página antigua en un host aún desconectado y copiaba su imagen de GPU
a 2D. Después se sustituía por la página reciente. El dibujo no podía mostrarse.

La llamada existente `deferDrawing` se adelanta a la actualización del
marcapáginas. Se conserva el dibujo visible posterior, la página de lectura,
las geometrías, los materiales, la resolución, la iluminación y los relojes.
La ruta compatible ya tenía esta protección; las rutas sin página y la
cancelación mantienen su comportamiento original.

## Controles causales y visuales

El candidato pasa 130 casos funcionales: 122 existentes y ocho nuevos.
El control original pasa los 122 existentes y cinco nuevos; los otros tres
fallan por el renderizado y copia ocultos. Se incorporan sólo dos archivos
nuevos de pruebas y una línea del runtime. CPU SHA
`aec582d3f77a95412f6a5f7dbaa58650aa09cb9994e5f15f39653a160bae7a8d`.

En DPR 2 y 1,5 pasan 16 pares exactos, 65.832.000 componentes RGBA,
16 PNG nativos y 16 exports PNG, además de 32 invariantes de exportación.
Cada perfil evita seis renders y seis copias ocultos en los casos que los
producían. Los casos que ya evitaban el dibujo mantienen cero. Permanecen
estables los 341 hechos de fuente, build y método. Navegadores y previews
cerrados. SHA `d7f9fa5441de7cfa85f2d995e3db8a515929467040578cc28e8721070e64ce52`.

El primer método gráfico conserva FAILED durante la limpieza de la fixture:
invocaba `PdfReader.destroy`, que no existe. Las ocho comparaciones previas
pasaban. Un namespace nuevo corrige sólo esa llamada a `close` y conserva
los casos, imágenes, assertions y plazos; no repite la batería CPU.

No se atribuye una mejora temporal al conteo gráfico ni se afirma que esta
rama explique los fallos de CI de versiones anteriores, que no capturaron
si el regreso era exacto o compatible. La comparación usa SwiftShader;
no acredita FPS, temperatura o batería de un teléfono físico.

## Fuente final y publicación

La adopción conserva los certificados HTTP, APK/loader y PDF público de
1.7.54 y su control de rendimiento público FAILED (un pase y dos fallos).
Las CI anteriores conservan sus veredictos y artefactos originales.

El primer guard de batería final rechazó la versión antes de ejecutar
comandos: el preparador copiaba la metadata 1.7.54 en vez de 1.7.55.
Ese fallo y sus helpers se mantienen. Los helpers de método 2 corrigen
la metadata y los nombres de importación en archivos nuevos; conservan
los comandos, assertions, fixtures y plazos originales.

La batería final pasa 2.980 unitarias en 219 archivos, build y 75
comprobaciones Python originales. Se mantienen 496 hechos de fuente y las
524 identidades del censo E2E original. El listado no ejecuta navegadores.
Evidencia `full-local-attempt2/summary.json`.

Los siete recorridos locales originales pasan al primer intento, sin retries,
flaky u omisiones. Los cierres alineado y legacy registran 4.369,5 y 6.109,5 ms
con los plazos originales de ocho segundos y treinta segundos globales.
El gesto isométrico conserva veinte composiciones sin nuevos renders de sala,
dos escrituras de buffer, 74 geometrías, 52 texturas, 34 programas y seis lomos
de 1.024 px. Fuente, métodos y build permanecen estables. Son medidas de
escritorio, no de teléfono físico. Evidencia `local-browser-attempt1/summary.json`.

Los primeros helpers locales preparados contenían metadata inválida y nunca
ejecutaron el navegador. El método 3 se deriva directamente del guard de 1.7.54
y de los conteos completados; el primer recorrido de navegador conserva su
namespace `local-browser-attempt1` y las siete QA originales sin modificar.

## Artefacto publicado

Fuente `636aecb85d215b0164c955e053a62725df250b17`, Pages
`f1ad5b3d64181da533bdbd30d1d939bce33b1587`; deploy original
`37236962459` SUCCESS. El primer pin HTTP conserva FAILED por recibir
el HTML anterior mientras se propagaba Pages. Un namespace nuevo contrasta
la fuente actual: 23 módulos y 44 recursos offline coinciden byte a byte.
Main real `main-CwBEFxBu.js`, 1.449.237 bytes, SHA
`ca8508049f88e57530ac5cc4cc414ec0778987107a9afcef66da38f5641e27cf`.
Certificado HTTP SHA `8da34e0c3b61e1229f6509dd17f654f55069d0c3fb5072344b3cebe00a2ae720`.

Los tres recorridos públicos originales pasan al primer intento, con 50
cuerpos HTTP contrastados, cero retries, flaky u omisiones. SHA
`bb139b861380b154ee5c516878ad3475d5c48bb8dcc4423024eedd5555867c70`.
Los 18 recorridos PDF públicos también pasan al primer intento: 310 cuerpos
HTTP y 15 capturas. SHA
`5e3b5b37f272a261be0514d855d43453117a4a8c8021d6208f6d9f0b6fdcf9b1`.
Los casos de narración PDF usan un motor controlado para comprobar posiciones;
las voces reales conservan su batería original separada en CI.

La APK descargada de nuevo conserva 1.1.4, código 17, 78.515.243 bytes y SHA
`feafaaa762b35344ac8b19418f9f6eb6cb1f725fba22b1ef3d3f273bd32a6191`.
Su inventario público contiene únicamente el loader de 2.089 bytes y dos
stubs vacíos. El loader coincide con Git, SHA
`8e03c3a6c8f840d9e9cf66637babe2d63742d2948d852534b865db0086aa9f34`.
La corrección web se entrega por ese loader; no se atribuye una captura
Android física nueva.

## CI original completa: FAILED

El run original `37236962479`, attempt 1, conserva FAILED. Diez jobs de
pruebas pasan y UI3 falla; el agregado también falla. Se conservan los 12 logs
y los 11 ZIP originales, contrastados con los tamaños y digests autenticados
de GitHub y con los CRC y hashes de sus miembros. Las 2.980 unitarias pasan
en 219 archivos, sin failed, pending ni todo.

El censo completo conserva 524 casos únicos: 522 expected, dos unexpected,
cero flaky y cero skipped. Hay 526 intentos, 522 aprobados y cuatro fallidos
(tres failed y uno timedOut), incluidos los dos reintentos originales. Los dos
casos unexpected son los contratos nativos alineado y legacy de UI3. El resto
de los grupos, incluidos los 220 casos de Supertonic, pasa su guard estricto.
La identidad de casos contrasta los diez manifiestos subidos con sus resultados;
la recogida FAILED no ejecuta un nuevo listado local `--list`.

Evidencia completa:
`ci-636aecb-failed-original-collector-attempt1/snapshot-001/certification.json`,
SHA `c45a2bb4702825ad14d9ef468229d0c05828eff700c4cb55c53504bcdf2a5c35`.
El watcher original conserva sus 29 observaciones y termina FAILED.

### Fallos de UI3 antes del cierre

El primer intento alineado y los dos legacy fallan en la expectativa original
de ocho segundos de `.ihr-flyout__cover-target`. Sus duraciones backend de
expectativa son 8.011,264, 8.006,617 y 8.006,588 ms; los clicks backend del
lomo duran 1.970,528, 1.991,271 y 1.972,962 ms. Los intentos completos duran
23.696, 23.931 y 25.949 ms. No llegan al click de portada ni a Back.

El reintento alineado sí pasa portada visible y readiness, en 2.819,750 y
954,089 ms. Su click backend del lomo dura 7.093,248 ms; el de portada,
26,071 ms. Después falla `.pdf-page-canvas` visible: el trace registra
8.011,548 ms de expectativa backend y el resultado completo conserva
timedOut de 33.949 ms con el límite global original de treinta segundos.
Su último snapshot serializado conserva `data-opening-phase="zooming"`.
Los cuatro traces registran cero llamadas a Back: no miden el plazo de cierre.

Los tiempos backend y del reporte son relojes distintos; no se dispone de
`clickedAt` DOM ni de un instante de finalización entre snapshots. Los tres
fallos de selección no serializan una fase de apertura final. No se convierte
una captura posterior en un pase. Los dos archivos de contrato E2E son idénticos
en Git entre las fuentes 1.7.54 y 1.7.55; no se cambian assertions ni plazos.

La recogida temprana preserva los cuatro traces en
`failure-ui3-636aecb-first-early-method2`, con `issues: []`, SHA de summary
`ba8e9917eaceab8f26777114245102f889f36928970a56cd6465b57c8c4d12ee`.
El entry y sus helpers están comprobados antes y después. Se conservan aparte
el primer log API pequeño, el fallo inicial de preparación de la copia y el
intento de copia que encontró el log ya existente. El ZIP y su metadata
reutilizados se confirman byte a byte en el recibo separado; la recogida completa
vuelve a comprobar el digest autenticado y extrae sus propios miembros.

Los pases locales y públicos permanecen separados de este FAILED original.
