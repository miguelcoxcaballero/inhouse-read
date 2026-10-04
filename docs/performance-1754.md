# Rendimiento de 1.7.54 — color de las macetas

## Conservación del modelo

Cambiar sólo el color de una maceta actualiza los mismos mapas del pintor
original en su nivel actual. Se conserva el modelo botánico, sus geometrías,
hojas, dimensiones, materiales, UV, filtros y anisotropía. La planta fern
dejaba de conservar 666 hojas y 18 tallos en cada cambio de color; ahora no
se reconstruyen. El catálogo mantiene cámara y encuadre. La estantería
conserva el modelo y actualiza el objetivo de interacción del nodo actual.

Los cambios de planta, forma, semilla o dimensiones conservan la ruta original
de reconstrucción. Se cancelan mapas de detalle pendientes del color anterior,
se liberan los mapas reemplazados una vez y el detalle posterior usa el color
vigente. No cambian luces, sombra, calidad, DPR ni relojes de animación.

## Pruebas funcionales y controles

El candidato final pasa 107 casos: 45 existentes y 62 nuevos en siete archivos.
El control original ejecuta sólo los mismos 62 nuevos: nueve pasan y 53 conservan
sus fallos causales de retención/API. Los 45 existentes del control se derivan
por identidades y bytes del run completo original de 1.7.52; no se repiten.
Ese run local precedía al commit final, y una comprobación separada confirma
que los archivos implicados coinciden con Git 1.7.52. No se atribuye ejecución
nueva al censo histórico. CPU final SHA
`eddc79307faeabd9bf0678249cb805dcfb50bf3bf5ccd783e41d6f06c3d29a1f`.

El primer método CPU conserva FAILED: 106/107 del candidato, incluidos todos
los 45 existentes, y control sin JSON tras ENOBUFS/SIGTERM del buffer de salida.
No se inventan conteos del control incompleto. El fixture nuevo había limpiado
su callback de idle sin drenar la cola; el caso falló antes de comprobar color.
El segundo namespace conserva los mismos tres runtime, drena sólo la cola
propia del fixture y escribe stdout/stderr directamente a archivos. Añade
comprobaciones escalares de identidad antes de mantener las assertions deep
originales, sin alterar plazos. El error y sus raw originales quedan intactos.

## Comparación gráfica y adopción

Los tres controles de plantas son idénticos byte a byte entre Git 1.7.52 y
Git 1.7.53. Se compara el candidato con el modelo fresco original usando
los mismos cámara, luces, PMREM, AA, alpha, pintor, mapas y niveles del catálogo.
Cinco macetas, cuatro colores, dos calidades y dos poses dan 80 pares por
DPR 2 y 1,5. Los dos primeros intentos pasan: 160 pares RGBA exactos,
192 millones de componentes, 160 PNG nativos y 160 exports PNG exactos.
Pasan dimensiones, metadata e invariantes de exportación; no hay errores de
consola. Los 521 hechos de fuente/método y build permanecen estables.

Certificado `pot-color-quality-attempt1/summary.json`, SHA
`e862f75088169b5f8f63966860c68a20d07831dbf253cbc57c136bbaef79f1e8`.
Ambos navegadores y previews quedan cerrados. Es una comparación de apariencia
en SwiftShader, sin atribuir FPS ni latencia a un móvil ni equivalencia de
sombras de toda la habitación a un fixture aislado de catálogo.

Se incorporan los tres runtime exactos, los 62 nuevos casos y la versión.
Sólo se relocalizan los imports de esas nuevas pruebas; la reversión recupera
sus bytes probados. La adopción exige también los certificados de web y APK
reales de 1.7.53. La QA original conserva fixtures, assertions y plazos.

## Fuente final

La fuente incorporada pasa 2.972 unitarias en 217 archivos, build y las 75
comprobaciones Python originales. Se mantienen los 494 hechos de fuente y las
524 identidades del censo E2E original. El listado no ejecuta navegadores ni
se usa como pase de E2E. Evidencia `full-local-attempt1/summary.json`.

Los siete recorridos locales originales pasan al primer intento, sin retries,
flaky u omisiones. Cierres nativos: 4.925,6 y 6.133,1 ms con los plazos originales
de ocho segundos y treinta segundos globales. El gesto isométrico conserva
veinte composiciones sin nuevos renders de escena, dos escrituras de buffer,
74 geometrías, 52 texturas, 34 programas y seis lomos de 1.024 px. Son medidas
de escritorio; no se atribuyen a un teléfono. Evidencia
`local-browser-attempt1/summary.json`.

## Publicación comprobada y fallos públicos originales

La fuente publicada es `05db048f9b4ddb07f4d24ad1d86cb75f2e770635`, con Pages
`e9532457ab6d16b5b119bf4562e11b35946c1e34`. HTTP pasa contra los objetos Git
de Pages: 23 módulos del grafo y 44 archivos del shell. El main recibido es
`main-dVFKszgL.js`, SHA
`e5c99c95f6bb378b42a51901ecbac59cbc4b2604696d7e5b35faf638d62c82ac`.
La descarga del APK y su loader pasan: conservan exactamente el APK firmado
1.1.4 y su loader de 2.089 bytes. Es comprobación de bytes públicos, sin nueva
captura en dispositivo ni nueva ejecución de verificación de firma.

Los 18 casos PDF originales públicos pasan al primer intento, retries 0,
contra 308 cuerpos HTTP de la aplicación atribuidos al mismo Pages.
Certificado `public-05db048-attempt1/browser-attempt1/certification.json`, SHA
`e4685387ec1755dd22ac91fc6db0465a8b4c6c8bb111517aead065a06a9a72b9`.

Los tres casos públicos de rendimiento conservan **FAILED**: uno pasa y dos
fallan, con exit 1 tanto del runner como del auditor, retries 0. El cierre
alineado observado acaba en 6.947 ms y su espera original de ocho segundos
pasa; el caso falla después por el límite global de treinta segundos al
exportar, tras los dos RAF y la captura posterior al cierre. La espera backend
del cierre legado sí agota los ocho segundos: 8.045,350 ms, con error. No hay
attachment de fin para atribuirle un tiempo DOM exacto de cierre. La captura
posterior restaurada no cambia el fallo original ni identifica su fase causal.

Los originales, trazas, cuerpos HTTP y tiempos backend están sellados en
`public-05db048-failure-review-attempt1/certificate.json`, SHA
`f8ddfa222d1a845dbc08eff5c1cef90b4be790c60e561fa6d381c2d5e4a7b30a`.
Los pases HTTP, APK y PDF no convierten estos dos fallos en pases.

## CI54 original: FAILED y colección completa

El run original `37235346810`, attempt 1, conserva fuente y conteos de 1.7.54.
UI3 termina FAILED: 40 casos, 42 intentos, 38 pases y dos casos inesperados;
cuatro intentos fallidos, dos retries, cero flaky, skips o errores globales del
reporte. Los cuatro intentos nativos fallan **antes de Back**, esperando que
`.pdf-page-canvas` sea visible; no ejecutan ningún click en `#reader-back`.
Las esperas backend originales son 8.005,883 y 8.008,089 ms para el alineado,
y 8.008,046 y 8.006,786 ms para el legado. También consta el límite global de
treinta segundos. Estos fallos de apertura no son mediciones del cierre.

ZIP original autenticado SHA
`cce299ead5bd8ecdf992322d3d697cf45f75901a6ccd88450f451a0196fb003f`;
resumen temprano `failure-ui3-05db048-first-early-method2/summary.json`, SHA
`4145145280a09396de1494f6cd837c9d7390698c306ed65387fd29fc94b51539`.
La revisión de llamadas originales queda en `native-call-review-attempt1/review.json`,
SHA `3c251a563a3c6e51389f46222b85dc43dc173021870ae2dbbc12a738b2dc20e3`.
No se atribuyen costes GPU o de funciones internas a esos intervalos del trace.

El primer snapshot parcial conserva nueve logs y nueve ZIPs autenticados:
2.972/217 unitarias pasan; 265 casos E2E dan 267 intentos, con sólo los dos
fallos conocidos de UI3, cuatro intentos fallidos y dos retries. UI1, UI2, UI4,
UI5 y los tres grupos neuronales pasan sin flaky, skips ni retries. En ese
snapshot faltan los 39 casos de UI6 y los 220 de Supertonic. Resumen
`ci-05db048-failed-original-collector-attempt1/snapshot-001/summary.json`, SHA
`e77d5b671449b47814f7ef799dedec3f9b02f337c1b86137b9828464760b7b7e`.
La copia de los originales tempranos UI3 se documenta en un recibo separado;
no se descargan de nuevo ni se cambia el estado del primer snapshot.

El run original termina **FAILED**: UI3 y el agregador `test` fallan, y los
otros diez jobs terminan con SUCCESS. El watcher cierra con exit 1, conserva
sus 29 polls y no invoca el auditor reservado a runs exitosos. Metadata y
métodos se sellan en `original-watch-history-attempt1.json`, SHA
`32a3299deb627056a7798d8aa48795dbe37d9c8d156499bf9d53541f2c3551f0`.
El SUCCESS de un job no sustituye la revisión de sus intentos originales.

La colección final conserva los doce logs y once ZIPs autenticados, sus
miembros originales y los reportes extraídos. Pasan las 2.972 unitarias en
217 archivos. El censo completo tiene 524 identidades E2E únicas: 522 pases y
los dos fallos de UI3 ya descritos. Son 526 intentos, cuatro timeouts y dos
retries, con cero flaky, skips o errores globales. UI1/2/4/5/6 pasan sus
45/38/50/29/39 casos; neural engine/reading/languages y Supertonic pasan
9/14/40/220, sin retries ni intentos fallidos.

El snapshot final no reemplaza el parcial ni los originales tempranos. La
colección reutiliza sus nueve ZIPs validados y añade UI6, Supertonic y los
tres logs restantes. Resumen `snapshot-002/summary.json`, SHA
`c187c257ebe345325aed3b1ed4f5439da8ee61bda12c196a1ab2faa10ffee0a7`;
certificado `snapshot-002/certification.json`, SHA
`e1e1bf49eea3687f117e2c8b8a6d5f84028c7a41db289c548cec920d993be6e4`,
bajo `ci-05db048-failed-original-collector-attempt1`. Se verifican los digests
autenticados, bytes de los ZIPs, miembros y métodos antes de sellar.

El alcance es el censo de manifests originales subidos por CI; esta colección
no ejecuta un nuevo listado local ni pruebas y conserva **FAILED**. CI53 y los
resultados posteriores de 1.7.55 conservan evidencias distintas.
