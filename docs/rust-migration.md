# Migración a Rust: primera integración, 1.7.116

Base descargada con `git fetch origin --prune`: `c83add7`, igual que el checkout
local limpio. La aplicación contiene 146 módulos JavaScript propios y unas
33.000 líneas no vacías. Esta integración migra cálculos concretos; **no es la
reescritura completa solicitada**. Pantallas, estado, persistencia, clientes de
Drive, la mayor parte de la geometría y la orquestación de los lectores todavía
necesitan su migración.

## Código ejecutado en Rust

- Reconocimiento de fuente de portada: puntuación completa de cada máscara.
  El worker conserva una imagen en la memoria WASM durante todo el trabajo;
  copia las máscaras por candidato y libera cada asignación temporal.
- PDF adaptable: elección de cortes entre columnas, detección de tablas y
  puntuación geométrica. Se devuelven las mismas referencias a las líneas,
  conservando texto, offsets UTF-16, párrafos y metadatos de PDF.js.
- Relieve: distancia interior, desenfoque, normales, mapa de materiales y
  recomposición independiente de las capas de color. Los buffers de salida son
  nuevos, se conservan los puntos de cancelación y se libera la memoria al salir.
- Marcapáginas: topología, posiciones, UV y normales. Se reutilizan los atributos
  de Three y unos 12 KB compartidos; las funciones trascendentes siguen en el
  host para conservar exactamente sus redondeos. Una pose combinada actualiza
  una sola vez la malla, con buffers de geometría idénticos en las comparaciones
  ejecutadas y sin cambiar los tiempos configurados de animación.

El núcleo no tiene dependencias Cargo, imports de funciones JavaScript, DOM,
acceso a cuentas, red ni archivos. Se compila con Rust 1.99.0, optimización 3 y
LTO. Los acumuladores mantienen el orden de cálculo en f64 y los mapas mantienen
los mismos redondeos f32 y Uint8Clamped que la implementación anterior.

## Integración y funcionamiento sin conexión

`npm run build:rust` genera `src/wasm/inhouse_read_core.wasm`; no se versiona un
binario suelto que pueda quedar obsoleto respecto a su fuente. Vite publica el
WASM con hash y el manifiesto offline incluye esos bytes y su SHA256. El APK
sigue cargando la web publicada desde su loader.

La carga no retrasa el primer fotograma ni los mensajes del worker. Mientras
se prepara o si el navegador no lo admite, sigue disponible el algoritmo
anterior. Las pruebas comparan directamente el WASM real, por lo que esa vía de
compatibilidad no puede ocultar un fallo del port.

## Evidencia inicial

Guardada en `D:/CodexEvidence/InhouseRead-20261011/rust-migration/`.

- Primera batería focal: 72 pruebas aprobadas en siete archivos.
- Segunda batería de relieve y worker: 32 aprobadas, incluidas comparaciones
  exactas de buffers de hasta 512 × 512, diez capas, cancelación y crecimiento
  de memoria entre fragmentos. El primer intento de relieve falló al resolver
  una URL de archivo en jsdom; se conserva ese fallo y el nuevo intento usa Node.
- Benchmark de fuentes en Node/Windows, i5-10600K: 15 tandas alternadas tras
  cinco calentamientos, 72 candidatos por tanda. Medianas 81,0006 ms JS y
  62,2661 ms Rust, incluyendo carga de la imagen por trabajo y copias de máscaras.
  Inicialización medida aparte; salida exacta antes y después de cada tanda.
  Memoria viva tras liberar el trabajo: 0 bytes; capacidad WASM estable después
  del calentamiento. Es una medición del cálculo en escritorio, no de Android
  ni del tiempo completo de abrir/cerrar un libro.

## Mediciones del núcleo final

WASM: 47.615 bytes, SHA256
`aaf8bd79b66a14b6528a51f4f43bdda89e8f57b4f6d66b84c63fca7568c041e8`.
Se normalizan las rutas de diagnóstico del compilador para que Windows y Linux
generen el mismo contenido. Los avisos de la biblioteca estándar se distribuyen
en `public/licenses/rust-1.99.0-library.html`.
Las mediciones incluyen copias de entrada/salida y asignaciones; se conserva
igualdad exacta con las implementaciones anteriores antes de cronometrar.

| Cálculo | JS, mediana | Rust, mediana | Entorno |
| --- | ---: | ---: | --- |
| 72 máscaras de fuente | 80,76 ms | 61,04 ms | Node, i5-10600K |
| 177 marcapáginas nuevos | 5,49 ms | 1,97 ms | Node, i5-10600K |
| 177 actualizaciones de marcapáginas | 4,16 ms | 1,10 ms | Node, i5-10600K |
| Distancia del relieve | 22,8 ms | 19,4 ms | Chromium, CPU ×4 |
| Desenfoque del relieve | 11,7 ms | 9,4 ms | Chromium, CPU ×4 |
| Normales del relieve | 49,8 ms | 27,8 ms | Chromium, CPU ×4 |
| Material del relieve | 25,1 ms | 15,7 ms | Chromium, CPU ×4 |
| Capas del relieve | 33,4 ms | 18,1 ms | Chromium, CPU ×4 |

Los relieves usan 384 × 512 píxeles y viewport 390 × 844. CPU ×4 es una
simulación de escritorio, no una medida de teléfono. En PDF el primer ensayo
detectó regresiones por copias: se conservaron los resultados y se eliminó ese
coste en páginas sin cortes posibles, con arena reutilizable de hasta 64 KiB
para las demás. El ensayo posterior conserva las particiones exactas en las
15 disposiciones. Las mediciones pequeñas están limitadas por la resolución
del reloj; no se interpretan tiempos redondeados a cero como coste nulo.

Primera batería completa: 3.727 pruebas/304 archivos aprobados, anterior a la
integración final del marcapáginas. Batería final: **3.749 pruebas/306 archivos
aprobados**, más 64 pruebas directas de kernels e integración tras normalizar
las rutas de diagnóstico del WASM. Python/Android: 105 aprobadas con el Python
incluido en el entorno. Build de producción aprobado: 98 archivos en el shell
sin conexión. Los siete recorridos originales locales pasan al primer intento:
regreso frontal/isométrico, interrupción por viewport, editor móvil, reserva sin
WebGL, ambos contratos de framebuffer nativo y gesto isométrico. Mantienen sus
plazos originales y no se aplican retries. Publicación pendiente de registrar.
Los dos timeouts E2E de 1.7.115 y la falta de medición en un teléfono físico
siguen como antecedentes pendientes. Estos resultados no demuestran una mejora
equivalente de la aplicación completa, del trabajo GPU, de batería o temperatura.

## Trabajo necesario para completar la solicitud

1. Migrar la lógica propia de biblioteca, lector, editor, gestos y audio,
   manteniendo los contratos de almacenamiento, DOM y plugins de Android.
2. Migrar la generación de geometría, materiales y escena conservando las
   coordenadas, texturas, reflejos, resolución y tiempos visibles.
3. Sustituir las implementaciones JavaScript restantes con pruebas de igualdad
   frente a la base, conservando únicamente los adaptadores de plataforma y las
   dependencias externas que sean necesarias.
4. Medir recorridos completos y consumo en Android real. Un benchmark de
   cálculos no demuestra por sí solo la fluidez global solicitada.

La revisión de rendimiento también detecta un caso pendiente en
`bookshelf-scene.js`: `bookPresentationScheduled` no vuelve a liberarse cuando
se cancela o falla la preparación diferida de los programas. El arreglo debe
permitir reintentar en el siguiente repintado estable ya requerido, sin crear
bucles de repintado ni temporizadores. No se ha modificado en esta entrega ni
se ha demostrado que explique los timeouts anteriores de CI.

## Continuación 1.7.117: lomo curvo y recuperación de preparaciones

**La migración sigue siendo parcial.** Esta continuación añade la generación
de posiciones, normales, UV e índices del lomo curvo a Rust; no sustituye las
pantallas, Drive, persistencia, lector, audio ni el resto de la escena. Conserva
la resolución de las mallas, materiales, cámaras y tiempos configurados. La
igualdad comprobada corresponde a los buffers y contratos ensayados; no es una
garantía absoluta sobre todos los píxeles o dispositivos.

El host conserva la trigonometría y el muestreo del relieve en el mismo orden.
Rust calcula la malla y las normales del grabado. El adaptador devuelve arrays
propios, libera la memoria temporal y los entrega directamente a los atributos
de Three. Se comprueba también el salto a índices de 32 bits cuando el índice
65.535 requiere reservar el valor de reinicio de primitivas.

### Mediciones del lomo

WASM de esta continuación: **49.932 bytes**, SHA256
`53cec33c06a184b510e2706cc387ad212e5ffc5c0ed86b672715be7f941ec3ee`.
Los ocho adjuntos de navegador, el benchmark Node y el archivo compilado local
coinciden en tamaño y hash. Los 32 hashes de posiciones, normales, UV e índices
coinciden entre el original, el puente Rust directo y la ruta de producción;
también coinciden entre Node y Chromium en estos ocho casos.

Cada comparación usa cinco calentamientos y quince tandas con orden alternado.
Incluye asignación y liberación, funciones del host, muestreo del relieve,
copias de entrada/salida, instalación de atributos e índices y disposición de
la geometría. No impone un umbral de velocidad para aprobar. Los casos pequeños
agrupan 64 o 128 geometrías por tanda; el grabado de estantería agrupa cuatro.
La tabla divide la mediana de cada tanda por ese número y muestra **milisegundos
por geometría**.

| Caso | Node JS → Rust | Chromium CPU ×4, JS → Rust |
| --- | ---: | ---: |
| Lomo sin grabado, 96 segmentos | 0,0231 → 0,0131 | 0,1375 → 0,1047 |
| Estantería sin grabado, 32 segmentos | 0,0097 → 0,0063 | 0,0633 → 0,0508 |
| Vista general sin grabado, 16 segmentos | 0,0069 → 0,0050 | 0,0383 → 0,0320 |
| Compatibilidad sin grabado, 12 segmentos | 0,0057 → 0,0050 | 0,0336 → 0,0305 |
| Grabado de estantería, 32 × 96 | 0,9698 → 0,2644 | 3,5500 → 1,3000 |
| Grabado detallado, 96 × 384 | 12,1270 → 2,8104 | 34,6000 → 11,8000 |
| Relieve suave detallado, 96 × 384 | 14,3926 → 4,6688 | 39,8000 → 17,8000 |
| Límite de índices de 32 bits, 255 × 255 | 25,3979 → 5,2575 | 73,7000 → 21,5000 |

Node 24.13.0 ejecuta en Windows con i5-10600K. Chromium usa viewport
390 × 844, DPR 2, entrada táctil y ralentización CPU ×4 en escritorio. Los
patrones son una máscara binaria determinista y un relieve trigonométrico
cuantizado. No se mide dibujo GPU, una sesión completa de la aplicación,
temperatura, batería ni rendimiento en un teléfono físico.

El puente directo llama al export real una vez por caso: ocho llamadas,
ocho asignaciones y ocho liberaciones comprobadas; quedan **0 bytes temporales
asignados** después de cada llamada. El pico temporal del grabado detallado es
2.382.424 bytes y el caso adicional de índices de 32 bits alcanza 4.192.280.
Esto no significa consumo total cero: los arrays de salida pertenecen a Three
y la capacidad de la memoria WASM puede conservar su máximo. La ejecución
Node completa termina con capacidad de 8.060.928 bytes; los contextos Chromium
independientes llegan hasta 5.308.416 bytes. Inicialización Node medida aparte:
0,555 ms para compilar/instanciar y 0,891 ms para la primera geometría.

Fuentes: `binding-benchmark-attempt1.json` y los ocho adjuntos
`rust-binding-browser-observation.json` de `binding-browser-attempt1.json`,
en el directorio de evidencias indicado arriba. Se conservan todas las muestras,
medianas, percentiles 95 y totales, incluidos los casos con ahorro pequeño.

### Fuentes tardías y preparación cancelada

La llegada de una fuente renueva las texturas de texto de los modelos retenidos
sin sustituir los botones, su foco ni la geometría de la estantería. La ruta de
canvas anterior actualiza únicamente su imagen. La regresión con un WOFF2 real
falla contra la web 1.7.116 publicada porque desconecta el botón enfocado y
sustituye los nodos; el mismo caso pasa con el build local 1.7.117. Se conservan
ambas ejecuciones en `font-public116-regression.json` y
`font-browser-attempt1.json`.

También se corrige el caso de preparación diferida descrito al final del
apartado 1.7.116: una cancelación o error vuelve a permitir el intento en el
siguiente repintado estable ya necesario. Completar o cancelar esa preparación
no crea temporizadores ni repintados adicionales. No se atribuyen a este cambio
los timeouts de CI sin una observación que demuestre esa relación.

### Estado de verificación

1.7.116 sí se publicó posteriormente: fuente
`dbd6205ed7580c1b5717638533e3aff27ed5536b`, Pages
`0f586bb1c6234306e26ebc6db1f977093fdc083f`. Se comprobaron 100 respuestas HTTP,
98 recursos sin conexión y 866 condiciones. Sus recorridos públicos quedaron
en **21/22**, con el fallo anterior al toque que motivó la corrección de fuentes.
La CI completa de 1.7.116 conserva dos timeouts de regreso nativo distintos de
ese fallo; no se han relajado los plazos ni convertido esos resultados en PASS.

La [verificación del APK público](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/38141440469)
aprobó los cinco estados nativos. Se auditaron el ZIP original y las capturas,
la política de barras/pantalla encendida y el APK 1.1.8 de 78.531.695 bytes con
SHA256 `5d10e6555c5c05e59925d18d5e0c959a08d8e41761a5aad37832c9d40d8e7eb1`.
Google muestra el formulario real de acceso; no se autenticó una cuenta humana.
La política de regreso se confirmó en la tercera muestra a 22,256 s, lo que no
acredita un cierre fluido ni el contrato separado de ocho segundos del navegador.

Para 1.7.117 pasan las 82 pruebas focales de geometría e integración, las
19 de recuperación de preparación, los ocho casos de geometría en Chromium,
la regresión real de fuentes, los siete recorridos originales locales y las
105 comprobaciones Python/Android. La batería unitaria completa de 1.7.117
está en ejecución; su publicación y comprobación HTTP todavía no se registran
como realizadas en este apartado.
