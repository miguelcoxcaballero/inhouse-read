# Rendimiento de 1.7.56

## Cambio

La devolución del libro sobre la estantería legada conserva su capa gráfica
para volver a componerla. Evita la segunda copia del framebuffer completo
en cada fotograma compatible. La estantería nativa alineada conserva su
captura original: su fondo puede cambiar cuando otro renderer dibuja.

Se comprueban propietario, contexto, generación, revisión del fotograma,
dimensiones físicas, posición y descriptor exacto. La exportación sigue
siendo sólo del libro y restaura la presentación visible. Cancelación,
dimensiones incompatibles y pérdida de contexto mantienen sus rutas.
No cambian geometrías, materiales, mapas, sombras, antialiasing, resolución,
densidad ni duración de las animaciones.

## Comparación aislada

Fuente de control `636aecb85d215b0164c955e053a62725df250b17` (1.7.55).
Pasan 59 casos en el candidato: 50 originales y nueve nuevos. El control
pasa los 50 originales y cuatro de los nuevos; falla los otros cinco.
Cuatro fallos demuestran la reducción de copias. El quinto comprueba una
llamada evitada al cache durante pérdida de contexto; el cache original ya
rechazaba esa llamada antes de trabajar en GPU. No se cuenta como otra
reducción de trabajo gráfico.

El wrapper de esa primera ejecución conserva FAILED por `KeyError` después
de guardar ambos informes y receipts. La observación posterior es sólo de
archivos, sin repetir tests ni reemplazar el fallo. SHA de la observación:
`6037f3c5a84c63decfb27dd99d92dd9670ee4cda0f7f3565abf5075b81a19720`.

La comparación gráfica de método 2 pasa sus 26 pares en DPR 2 y 2,75:
253.328.880 componentes RGBA sin diferencias, 26 PNG nativos y 26 exports
exactos, 104 invariantes. Las primeras seis poses de cada densidad pasan de
doce copias a seis. También se comprueban exportación, cambio de propietario,
fondos y dimensiones incompatibles, cancelación y pérdida y restauración
reales del contexto. Los 1.014 hechos de fuente/método permanecen iguales;
los navegadores y servidores de prueba están cerrados.

Certificado `legacy-insertion-quality-attempt2-final/summary.json`, SHA
`f960b69dd13a94bf494eeb4d00f8b0f7d106968979625f08f723829ac35bfdfa`.
El primer método gráfico conserva FAILED: completó doce pares exactos y
se bloqueó al solicitar restauración de contexto antes de terminar su evento
de pérdida. El método 2 espera un RAF nativo y limita la espera diagnóstica
de los eventos; no modifica el reloj de las animaciones ni las assertions.

Estas comparaciones acreditan igualdad visual y menos copias. No miden FPS,
temperatura o batería en un teléfono, ni explican los fallos de apertura de
la CI de 1.7.55. Los resultados de cada ámbito conservan su estado.

## Incorporación y verificación final

Se incorpora únicamente `bookshelf-scene.js`, el archivo con nueve casos
unitarios nuevos y la metadata de versión. La batería final pasa las 2.989
unitarias de 220 archivos, build y 75 comprobaciones Python originales.
Se mantienen 497 hechos de fuente y las 524 identidades del censo E2E
original; el listado no se cuenta como ejecución de navegador.
Evidencia `full-local-attempt1/summary.json`.

Los siete recorridos locales originales pasan al primer intento, con cero
retries, flaky u omisiones. Los cierres alineado y legacy registran 4.286,3
y 6.134,5 ms con los plazos originales de ocho segundos y treinta segundos
globales intactos. El gesto conserva veinte composiciones sin nuevos renders
de escena, dos escrituras de buffer, 74 geometrías, 52 texturas, 34 programas
y seis lomos de 1.024 px. Fuente, build y métodos permanecen estables.
Son medidas del navegador de escritorio, no del teléfono físico.
Evidencia `local-browser-attempt1/summary.json`.

## Artefacto publicado

Fuente `b07aa6c14d64f77b5cdbfefae10aba70653e58a1`, Pages
`3cbd017b68f1da8f55f8c100f0e403da343a8a17`, deploy original
`37239526266` SUCCESS. El primer pin conserva FAILED al recibir el HTML
anterior durante la propagación de Pages. El segundo namespace contrasta
los bytes actuales: 23 módulos y 44 recursos offline coinciden exactamente.
Main real `main-B90_hcG4.js`, 1.450.138 bytes, SHA
`5663776aefe33caf120cd46c9b8d77ffc928c8643c77388549f158373adacc58`.
Certificado HTTP SHA
`63de96bad4e88f5f677aa34dd01359b715e882cf24a6fb35af48d1788ab64d40`.

Los tres recorridos públicos originales de editor y regreso pasan al primer
intento: 50 cuerpos HTTP contrastados y cero retries, flaky u omisiones.
Certificado SHA
`893bea4bf94c03d41f139995ec4fb2182238a43c9010981ca150c61347329fc1`.
Los 18 recorridos PDF públicos pasan al primer intento, con 309 cuerpos
HTTP contrastados, 15 capturas y cero retries, flaky u omisiones. SHA
`a5590db882079355975492d2f98ba543ea30b3f1b9abfd5c72aae2bbb9bbd31b`.
Los casos de narración usan un motor controlado para comprobar posiciones;
las voces con pesos reales conservan su batería original en CI.

La APK descargada de nuevo mantiene 1.1.4, código 17, 78.515.243 bytes y SHA
`feafaaa762b35344ac8b19418f9f6eb6cb1f725fba22b1ef3d3f273bd32a6191`.
Contiene únicamente el loader público de 2.089 bytes y dos stubs vacíos.
El loader coincide con Git, SHA
`8e03c3a6c8f840d9e9cf66637babe2d63742d2948d852534b865db0086aa9f34`.
La corrección web se entrega mediante ese loader; no hay una nueva captura
de Android físico ni cambios nativos que requieran otro wrapper.

## CI original completa

La CI original de esta fuente, run `37239526267`, attempt 1, termina FAILED.
Se conservan los doce logs y once ZIP autenticados, sus bytes, digests,
miembros y manifiestos originales. Pasan las 2.989 unitarias de 220 archivos.
El censo completo contiene 524 identidades E2E: 521 expected, dos unexpected
y un flaky; 527 intentos, 522 passed y cinco timedOut, tres retries, cero
omisiones, casos sin ejecutar o errores globales del informe. Los ocho
restantes grupos E2E pasan, incluidas las 220 voces Supertonic.

UI3 conserva los cuatro intentos fallidos de los dos contratos nativos.
Todos pasan selección de portada y preparación; fallan la visibilidad de
`.pdf-page-canvas` durante apertura, antes de Back. Las cuatro esperas
backend registran 8.006,757, 8.012,130, 8.009,839 y 8.006,667 ms; los informes
conservan el timeout global original de treinta segundos. Los últimos
snapshots muestran `zooming`, lector preparado y BODY en apertura/lectura.
No hay un timestamp DOM de clic ni fin de fase, y no se mide el cierre de
ocho segundos en esos intentos. La primera espera de portada figura PASS
aunque su llamada backend dura 9.217,847 ms: se conserva ese resultado sin
reinterpretar el reloj del producto ni el mecanismo de polling.

UI6 conserva el caso `spine-materials.spec.mjs`, «lomo nítido: tintas,
metales y grabado persistentes en móvil», como flaky: primer intento
90.626 ms timedOut esperando Editar, reintento PASS de 32.679 ms. Después
de Back se usa el clic normal original del lomo. El punto registrado está
dentro de su rectángulo y su geometría permanece igual entre los snapshots
de acción y después; cambian la apariencia y los contadores de layout/render.
No aparece un flyout en esas capturas. Las referencias delta se han resuelto
con el algoritmo de Playwright; no demuestran identidad del nodo, estado
busy, resultado del raycast ni causa del clic perdido. No hay trace del
reintento exitoso. El primer fallo y el flaky no se reclasifican como PASS.

Certificado completo
`ci-b07aa6c-failed-original-collector-attempt1/snapshot-001/certification.json`,
SHA `a45a7a681e371f7d2dca3934a0d8f9ec1ad4ae41dc7a93563d4f4399866ce088`.
El censo de esta recogida contrasta los diez manifiestos originales subidos;
no ejecuta un nuevo `--list` local. UI3 y UI6 reutilizan únicamente sus ZIP
y logs originales ya autenticados, con receipts separados y revalidación
completa del collector. Las entradas de los métodos tempranos se comprueban
antes y después. No se repiten CI, tests ni retries ni se cambian plazos o
assertions. Los pases locales y públicos y los fallos anteriores conservan
sus estados separados.
