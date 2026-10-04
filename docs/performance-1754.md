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

Pendientes: CI original y comprobación de web y APK publicados.
Los fallos anteriores conservan su propio estado.
