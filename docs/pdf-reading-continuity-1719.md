# Lectura de PDF y continuidad del audiolibro · 1.7.19

Implementación: `4670a4273506b04dc9c269e3de7fd2e1d0390b1e`. Fuente de verificación: `524a7c3fb69a1012d1cb8922e6a2c070736b5955`. Sus cambios posteriores afectan sólo a observadores y presupuestos de tests; el runtime permanece intacto. La actualización funciona en la web y en Android mediante su cargador web.

## Cambios

El PDF adaptable, el audiolibro, la búsqueda y el resaltado comparten la distribución del texto. Se agrupan fragmentos por posición, se leen columnas completas y se conservan los índices de cada frase en la página original. Un salto de línea deja de convertirse automáticamente en un párrafo: su separación depende del interlineado local. Se comprueban incrementos modestos y espacios grandes. Capitulares, superíndices y cambios de fuente no desplazan por sí solos el texto.

Los PDF geométricos entregan `headerRanges:[]`: sin cabeceras confirmadas, se conservan los párrafos cortos repetidos al activar «omitir cabeceras repetidas». Sólo se excluyen rangos válidos confirmados. El audiolibro mantiene sus índices; los lectores sin esta información conservan la heurística anterior. La opción sigue desactivada por defecto y no se añade detección de cabeceras entre páginas.

Al acabar una sección EPUB, la voz espera a que termine el giro de página pendiente de la última frase. Antes, Foliate podía ignorar el siguiente avance durante su bloqueo de navegación; esto se interpretaba erróneamente como final del libro. Pausa, Detener y cerrar cancelan el avance pendiente antes de iniciarlo.

## Verificación

- **2.262/2.262 unitarias en 133 archivos y 342/342 E2E aprobados** (213 de interfaz y 129 de motores de voz reales) en [Production checks 37126412116](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/37126412116). El certificado de la fuente final contrasta todas las identidades esperadas; no contiene incidencias.
- **37 verificaciones públicas suplementarias en cuatro tandas:** 35 históricas (20 de lectura `4670a42`/Pages `db4019f`; 14 del editor con observador `af9deae`; una sesión real de voz `4670a42`) y dos nuevas con observador `524a7c3`/runtime `4670a42`. Se mantienen sus procedencias; no se suman a CI ni se atribuyen a otro commit.
- Los dos casos nuevos —editor y papelera de 320 px— pasan sin reintentos, omisiones ni errores. Se revisaron cuatro PNG y dos JSON. La copia suplementaria de smoke sólo adapta `goto` al URL público; CI ejecuta el original. Aserciones y límites permanecen intactos.
- Las 20 de lectura comprueban PDF original/adaptable, columnas, frases entre líneas, capítulos completos, Pausa/Detener, temas y resaltado. El PDF base, de dos páginas con orden interno mezclado, contiene 12 frases. Otra variante añade dos párrafos «A pause.»: con `skipHeaders:true` se conservan sus 14 frases, incluidas ambas repeticiones. Las dos vistas respetan cada orden esperado sin omisiones ni duplicaciones. Se revisaron sus capturas.
- Las 14 del editor pasan sin reintentos ni omisiones. Se autenticaron sus trazas y revisaron 14 PNG de escritorio, móvil, horizontal y temas claro/oscuro. Las propuestas de relieve conservan los colores. Un gesto interrumpe el balanceo y vuelve a cero en 365,5 ms. Son pruebas de Chromium con WebGL por software.
- Voz Lessac/Piper auténtica, velocidad 1× y relojes normales: 365,03 segundos, cambio de capítulo, sin errores, paradas automáticas ni underruns. A los 300 segundos había 110 fragmentos iniciados/109 terminados; el checkpoint final registra 133/132. El registro completo alcanza 134/133 antes de Detener manualmente. Seguía leyendo: no es una prueba del final del libro. Los pesos se sirven mediante el transporte de fixtures de la suite; el WAV conserva PCM programado, no una grabación física.
- También se probaron 18 capítulos/36 fragmentos con reloj simulado; el motor completa 26 fragmentos durante 392,6 segundos sin liberar el worker activo.
- Nueva comprobación `524a7c3`: 47 respuestas HTTP 200 exactas, incluidos 20 módulos/estilos y 40 archivos del shell offline. APK 1.1.3/código 16 descargada de nuevo: 3.174.689 bytes, cargador de 2.089 bytes y firma V2 válida. No se cambia código nativo ni se genera otra APK.

## Publicación, evidencia y límites

Pages `2c0e08c610e50e7efc98e077ce6c484c30268347` conserva los 85 objetos del árbol original. Entrada autenticada `assets/main-DFRj9c-Q.js`: 1.382.812 bytes, SHA-256 `d160c679195259d56af0d27eb8538f8a89830569f96ea7b7ef6fd7b1e2ad6d12`. Las trazas autentican cuerpos completos; las respuestas sin cuerpo registrado se distinguen en los certificados.

Certificados fuera de Git, bajo `.animation.local/reading-text-1719/`:

- `ci-37126412116/certification.json`: batería final completa, fuente `524a7c3fb69a1012d1cb8922e6a2c070736b5955`.

- `public-final2/certification-v3.json`: 20 pruebas de lectura conservadas.
- `public-cover-observer-v2/certification-v2.json`: 14 del editor; SHA-256 `c51c3b8daefeaa055992798c4e32c7f46e4f497db8fff2a9e71029e7882c5dff`. Revisión de 14 PNG: `visual-and-semantic-review.json`, SHA-256 `d880f23c65117e5448ae8ae1263a812f6026eaeac0d3920589ef78e3fd6cf196`.
- `real-lifetime-https/certification.json`: voz durante 365 segundos, SHA-256 `0280e2152735c6a9072f83d8692e5aa4470b3af7051cd2d69c9da924ef7e149c`.
- `public-shelf-observer-524a7c3/certification.json`: dos casos nuevos, SHA-256 `9726e5f45ef0d12e84715dfe9f444346ce78370c9a3a0d1fae8a69b16fe8f751`. Revisión: `visual-and-semantic-review.json`, SHA-256 `e2d29454bd47e82ebbde75f666b87962a2cbb757bceb1ae448d54a66c3a12f5a`.
- `http-apk-certification-524a7c3.json`: HTTPS/APK nuevos, SHA-256 `fa244ee040b0ae11f76efb1d038b608fac806cf13cfdac85ad92c963be2a6c0c`.
- `pages-equivalence-524a7c3.json`: 85 objetos idénticos, SHA-256 `a4cf3ee001d584922af69c712b7b8411ce0da8abf09b3c5201a4a414e43d8d3a`.
- `ci-rejected-37124237250/certification.json`: rechazo íntegro anterior, SHA-256 `77cf6dec206237e511b2d1a7f52a6e0bd20062d3dab4d813a5e174fbb7d9be9a`.
- `original-smoke-diagnosis-af9.json`: observaciones originales de cierre, SHA-256 `170c8c9858410a88d41e13e58e83584ac222980c8913a82e130edd4adcd911fa`.

La CI `37124237250` permanece rechazada: smoke aún mostraba cierre a +18,920 s; la expectativa falló a +20,102 s y un snapshot a +20,332 s mostró clases limpias/libro colocado. Se desconoce el instante exacto del cambio; el retry pasó. La papelera de 320 px agotó dos veces el presupuesto global de 90 segundos durante la recarga. `524a7c3` ajusta el observador de cierre a 30 segundos y exige estantería visible/libro colocado; amplía ese escenario compuesto a 150 segundos. Conserva límites locales, guardas físicas, animaciones, píxeles y persistencia. Los rechazos anteriores permanecen separados y no cuentan como aprobados.

La geometría es una inferencia, no una garantía universal. No se añade OCR: un PDF sin texto seleccionable lo necesita. Geometría incompleta o escritura vertical mezclada conserva el tratamiento anterior. No se encontró un temporizador de corte a cinco minutos. Se corrigió la carrera reproducida entre capítulos; esta observación no garantiza toda sesión ni certifica GPU, FPS o funcionamiento en Android físico.
