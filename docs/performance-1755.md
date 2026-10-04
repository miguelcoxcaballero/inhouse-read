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

Pendientes: comprobación de web/APK publicados y el run original de CI.
