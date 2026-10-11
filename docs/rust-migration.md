# Migración a Rust: implementación y comprobaciones

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
aprobó **3.774 pruebas en 307 archivos**. Se publicó la fuente
`e137376068b82bc7051e85754c755b8334b3916d`, Pages
`bd5e3531b702e265d0169ff48f14a8eccbc88b26`: 100 respuestas HTTP,
98 recursos y 871 condiciones correctas. Sus **23 recorridos públicos** pasan
sin omisiones ni reintentos, incluidas fuentes tardías, ambos regresos nativos,
contenido PDF adaptable y funcionamiento sin conexión. El auditor inicial
rechazó adjuntos JSON con cuerpos base64 por esperar rutas de archivo; la
segunda versión audita esos mismos originales, sin repetir el navegador ni
sustituir los bytes. Ambos informes se conservan.

El [APK sobre la web 1.7.117](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/38143049356)
también aprobó sus cinco estados nativos. ZIP original de 8.942.303 bytes,
SHA256 `e6b3842782f367dd65473802e51ffded09e25eb83108169c3c8032ea3e2a60c3`.
Mantiene el mismo APK público 1.1.8; la captura final muestra el libro en su
estante. La política final se confirmó a **41,44 segundos** en ese emulador:
no acredita fluidez, el contrato de ocho segundos del navegador ni velocidad
en un teléfono físico. La CI completa 1.7.117 terminó con **542/545 casos
estrictos aprobados, dos fallos y uno inestable**: 548 intentos, tres reintentos,
sin casos omitidos, duplicados ni errores de colección. Se autenticaron los
once ZIP y las fuentes de doce jobs. Conserva los dos timeouts de regreso
nativo y un caso de importación Android que sólo pasa al reintentarse. En este
último, el observador de la aserción llegó después del estado transitorio de
cierre; el original sigue siendo un fallo estricto. No se han ampliado plazos.

## Continuación 1.7.118: páginas tridimensionales

Rust construye ahora el bloque de páginas cerrado y las hojas que se ven
durante la apertura. Conserva posiciones, normales, UV, colores por vértice,
índices, grupos de materiales y versiones de los atributos. Las resoluciones
originales no se reducen. El host conserva `Math.pow` y `Math.hypot` para
mantener sus redondeos; Rust escribe el resto de los atributos e índices.
La memoria temporal se libera en `finally`; las salidas tienen buffers propios.

WASM: **57.210 bytes**, SHA256
`98cbdc0ffce776f0ee8b02340b1ca6913e50a94f1908c2bc84d749d99d709ffe`.
Las 101 comprobaciones focales pasan: 15 de páginas, 12 de lomo curvo y
74 de integración de modelos. Incluyen dimensiones deterministas aleatorias,
grupos, ceros con signo, crecimiento de memoria, operaciones anidadas y fallo
de asignación. Ocho casos en Chromium ejercitan el export WASM real, el puente
y la ruta de producción, con igualdad exacta frente al código previo congelado.

| Malla | Node JS → Rust (ms) | Chromium CPU ×4, JS → Rust (ms) |
| --- | ---: | ---: |
| Bloque de estantería | 0,0285 → 0,0089 | 0,1188 → 0,0516 |
| Bloque detallado | 0,0427 → 0,0125 | 0,2453 → 0,0953 |
| Bloque fino | 0,0454 → 0,0123 | 0,2625 → 0,0969 |
| Bloque ancho | 0,0477 → 0,0123 | 0,2844 → 0,1016 |
| Hojas en la primera página | 0,0248 → 0,0076 | 0,1297 → 0,0516 |
| Hojas a mitad del libro | 0,0270 → 0,0075 | 0,1188 → 0,0484 |
| Hojas finas | 0,0198 → 0,0063 | 0,1031 → 0,0391 |
| Hojas anchas | 0,0329 → 0,0102 | 0,2094 → 0,1000 |

Medianas por geometría, incluyendo coeficientes, asignaciones, copias y creación
y liberación de la geometría de Three. Node usa cinco calentamientos y quince
tandas alternadas de 128 geometrías; Chromium, tres calentamientos y diez tandas
de 64. El máximo temporal es de 15.304 bytes, una asignación y liberación por
caso, sin asignaciones temporales vivas al terminar. La capacidad WASM permanece
en 1.179.648 bytes y los arrays de salida siguen vivos mientras los usa Three.
Son cálculos pequeños: **no demuestran una mejora equivalente en FPS ni una
reescritura completa de la aplicación**. Evidencia: `page-mesh-benchmark-attempt1.json`
y `page-mesh-browser-attempt1.json`.

También se conserva el filtrado anisotrópico de las texturas al regenerar el
texto del lomo. Antes la sustitución restablecía el valor a uno, perdiendo nitidez
en ángulo. Cuatro regresiones con modelos reales comprueban valores independientes
del color y del mapa de materiales, propiedad de los buffers y disposición única.

Build de producción y batería completa 1.7.118 aprobados: **3.793 pruebas en
308 archivos**, más 105 comprobaciones Python/Android. Pasan ocho recorridos
locales al primer intento, sin cambiar plazos ni aserciones: devolución en ambas
vistas, cancelación por viewport, fuente real tardía, editor móvil, compatibilidad
sin WebGL, ambos contratos nativos y gesto isométrico. Se publicó después la
fuente `b57b5ee8aea3890a6dddc4b0d3124c0419809cae`, Pages
`8beed00129527ef4aeca9a357353dbd3b4f5aa04`. Los **23 recorridos públicos**
pasaron y sus respuestas reales de entrada fueron auditadas contra el artefacto
fijado. Las 100 respuestas HTTP guardadas coinciden con Pages y el build118.
El primer verificador conservó dos fallos porque comparó esos bytes118 con el
núcleo local119, ya compilado: la auditoría posterior usa los mismos originales
y el dist118 preservado, con 742 comprobaciones correctas y ninguna nueva
petición. Ambos informes se conservan; no se reescribe el resultado fallido.
La comprobación nativa38144600262 aprobó el APK, su cargador de 2.107 bytes,
los cinco estados de pantalla y el formulario real de Google. La política de
regreso se observó a 39,555 s, todavía con el libro en plena animación: no prueba
su inserción final ni fluidez. Se conservan cuatro errores previos de captura.
La CI118 completa conserva **550/553 aprobados estrictos, dos fallos y uno
inestable**: 556 intentos y tres reintentos. Once ZIP autenticados, doce jobs,
sin omisiones, duplicados ni errores de colección. Son los dos regresos nativos
y la importación Android ya descritos; las cuatro suites de voces pasan.

## Continuación 1.7.119: color de portada y página de cierre

El agrupamiento del color dominante pasa a Rust. Se conservan el muestreo por
filas, el umbral alfa, la elección del primer centro en los empates, las siete
iteraciones y el redondeo final de JavaScript. Sólo cruza el puente la muestra
RGBA, con arena limitada a 32.768 candidatos, sin retener la imagen completa.
El analizador carga el adaptador sin detener la decodificación de la portada;
la ruta previa permanece disponible mientras el núcleo se prepara.

El cierre usa directamente el canvas independiente que entrega el lector para
su capa de página inmóvil y para la textura de WebGL. Evita una copia completa
de píxeles. La alternativa sin WebGL conserva una copia separada porque necesita
dos propietarios DOM. Se mantienen las dimensiones, la página, las imágenes,
el tema, el orden de persistencia y los tiempos configurados de las animaciones.

Núcleo preparado: 58.598 bytes, SHA256
`04438e836e131ca5ca91ea4c2efaa999928c9ff228ced411dce9ec8f98f50ec6`.
Primera comprobación focal: 48 pruebas en cuatro archivos aprobadas. La batería
unitaria final aprueba **3.825 pruebas en 310 archivos**, más 105 comprobaciones
Python/Android. Los ocho recorridos originales locales pasan al primer intento
con sus plazos y aserciones originales. Las mediciones y recorridos focales se
detallan abajo junto a la publicación119. No certifica una reescritura
completa ni una mejora global de rendimiento.

### Mediciones y propiedad de la página

Las diez comparaciones del segundo ensayo conservan exactamente los RGB.
Las nueve muestras con píxeles incluidos usan el export Rust real, una llamada,
una asignación y una liberación por imagen. La muestra cuyos puntos son todos
transparentes utiliza expresamente la salida previa del host; no se atribuye
su resultado a Rust. Se añadió además otra muestra con alfa mixto dentro de
los puntos muestreados.

| Caso | Node JS → nueva ruta (ms) | Chromium CPU ×4, JS → nueva ruta (ms) |
| --- | ---: | ---: |
| Color uniforme | 0,6857 → 0,1114 | 2,8375 → 0,5375 |
| Dos tintas | 0,7056 → 0,1168 | 2,8625 → 0,5313 |
| Colores fotográficos sintéticos | 0,8274 → 0,1589 | 3,5250 → 0,8188 |
| Degradado | 0,7227 → 0,1209 | 2,8938 → 0,5625 |
| Muestra vacía, sin Rust | 0,0041 → 0,0052 | 0,0313 → 0,0562 |
| Transparencia mixta | 0,4605 → 0,0934 | 2,0063 → 0,4500 |
| Miniatura | 0,2684 → 0,0441 | 1,2563 → 0,2125 |
| Límite de muestreo cada píxel | 2,6748 → 0,5476 | 12,5563 → 2,4625 |
| Muestreo cada dos píxeles | 0,6518 → 0,1229 | 2,7562 → 0,5813 |
| Portada horizontal | 0,7222 → 0,1199 | 2,9063 → 0,5875 |

Son medianas por portada, incluyendo validación, muestreo, copias y memoria.
Node usa cuatro calentamientos y quince tandas alternadas de 32 portadas;
Chromium, tres calentamientos y diez tandas de 16. Se conserva visible el pequeño
sobrecoste de validación del caso vacío, así como el primer ensayo, donde ese
caso se enviaba innecesariamente a Rust. El pico temporal medido es de 28.712
bytes; la imagen habitual de 192×288 utiliza 9.072. No quedan arenas temporales
vivas, aunque WASM conserva su capacidad de 1.179.648 bytes. Estos ensayos no
miden decodificación, GPU, autonomía ni fluidez global en un teléfono.

Pasan doce casos Chromium: los diez anteriores y dos que cargan módulos HTTP,
decodifican PNG reales y exigen llamadas al núcleo durante el análisis de
producción. El segundo retiene la descarga real del WASM: la portada sigue
analizándose mientras espera y utiliza Rust al estar disponible. También pasan
cuatro cierres reales con PDF físico, PDF adaptable ilustrado en sepia, EPUB y
compatibilidad sin WebGL: comprueban identidad de la fuente, píxeles completos,
propiedad DOM durante la entrega y retirada de las capas al terminar. Sus
lecturas de píxeles verifican funcionalidad; no se usan como medida de velocidad.

Evidencia: `cover-color-benchmark-attempt2.json`, `cover-color-browser-attempt2.json`
y `reader-return-canvas-attempt1.json`. El intento unitario2 se conserva fallido:
su observador esperaba una copia WASM aun en una muestra vacía. Ahora comprueba
la ausencia de copia en esa rama y añade un único píxel incluido para comprobar
el orden completo de entrada al núcleo. El intento3 aprueba las 31 pruebas.

119 se subió a main `110d70ed8aba44d6ce8e3a0119578c4caef5a2bb`, Pages
`afba86d6aea4ac4fe2f1f30c65b90cedd9a594cb`. El verificador de las respuestas
reales aprueba **101 descargas, 99 recursos del shell y 889 condiciones**.
Esta vez el build local119 se congeló antes de compilar el siguiente núcleo;
su identidad no depende del estado posterior del checkout. CI119 todavía está
en curso. Los **27 recorridos públicos** pasan al primer intento,
con 27 respuestas de entrada reales auditadas contra el artefacto publicado.
El APK38145829318 mantiene firma, tamaño y cargador; sus cinco estados nativos
pasan y la captura final muestra el libro en su hueco. La política final se
confirmó a 34,939 s en la sexta muestra, conservando cinco errores anteriores:
no prueba una mejora de velocidad ni comportamiento en un teléfono físico.

## Preparación 1.7.120: clasificación de varios colores

La clasificación de las zonas del relieve prepara una vez los valores OKLab
de la imagen y usa Rust para calcular las pertenencias a cada color. Conserva
los umbrales alfa, los radios, los empates y el orden de los cálculos. El host
mantiene `Math.cbrt` para conservar sus redondeos exactos. Una arena por trabajo,
limitada a 512×512 píxeles, se libera antes de componer los mapas; otra tarea
concurrente usa inmediatamente la ruta previa. No se guarda una imagen extra
por libro. El WASM puede conservar la capacidad de memoria tras liberarla.

El candidato sólo prepara esa arena para tres o más colores y al menos 16.384
píxeles. Las imágenes pequeñas, uno o dos colores y el cambio de intensidad de
un relieve ya clasificado mantienen su ruta previa. El máximo temporal es de
6.557.696 bytes; una portada de 341×512 usa 4.368.896. Hay cancelación entre bloques
de 1.024 píxeles. Las vistas se recuperan tras crecer la memoria, también cuando
lo provoca el conversor del host; se rechazan entradas que compartan esa memoria.

Las primeras **28 pruebas unitarias** pasan con el WASM real y comparan máscaras,
propietarios, alturas físicas, brillo, metal, normales y materiales completos.
El ensayo Node conserva las salidas de catorce casos y registra, incluyendo
preparación, copias y liberación, 76,87→12,93 ms para diez colores en 341×512.
Un solo color pasa de 7,61 a 8,05 ms al forzar el candidato: por eso no se activa
en esa rama.

Los **28 casos Chromium CPU ×4** pasan con igualdad completa de mapas y uso
real del export. El proceso completo de mapas (tres tandas alternadas después
del calentamiento, incluyendo preparación y copias) registra estas medianas:

| Portada / capas | Ruta anterior (ms) | Nueva ruta (ms) |
| --- | ---: | ---: |
| Estantería / 3 | 70,9 | 42,5 |
| 341×512 / 3 | 280,8 | 154,0 |
| 341×512 / 10 | 916,7 | 284,8 |
| Fotográfica sintética 512×512 / 10 | 1.522,1 | 400,4 |
| Alfa disperso 341×512 / 10 | 658,8 | 233,8 |

Las ramas excluidas no llaman al clasificador Rust en producción: un color
89,6→90,5 ms, dos colores 182,5→190,1 ms y miniatura 35,7→38,1 ms en esta
muestra corta. No se presentan esas variaciones como mejoras. El mayor buffer
WASM retenido observado alcanza 9.109.504 bytes; cero arenas temporales vivas
al finalizar. Las comparaciones completas incluyen normales y materiales; los
tiempos de la tabla miden la construcción de mapas, sin decodificar imágenes,
pintar WebGL ni medir un teléfono. Batería final y publicación pendientes.

### Cierre en frío: reproducción y corrección

El primer regreso de un libro importado podía recibir un controlador de
estantería antes de que el análisis inicial creara su hueco. `returnToShelf`
resolvía false y el finally quitaba la página, sin recorrer la animación.
Ahora espera al análisis y al render semántico posterior. La espera se cancela
al cerrar o destruir el controlador, cambiar el viewport o marcador, borrar
el libro o perder su geometría; no añade sondeos ni espera el ajuste de fuentes.
Si el destino deja de estar disponible, se usa el fundido existente una sola
vez en lugar de retirar la página abruptamente.

La prueba usa una importación Android real del fixture PDF y una pausa explícita
en el análisis inicial. Un build de control sin la corrección falla: la página
ya no está conectada y el cierre terminó antes de liberar el análisis. El build
corregido pasa: los mismos píxeles permanecen visibles, se recorren zoom,
marcapáginas, cierre, regreso e inserción, y no quedan capas ni canvas sobrantes.
Se mantienen los bytes originales. No se cambiaron los plazos de los tests
nativos originales. El caso funcional nuevo no acredita velocidad ni FPS.

Evidencia: `cold-return-negative-browser-attempt3.json` y
`cold-return-fixed-browser-attempt1.json`. Dos intentos previos del servidor
de desarrollo quedaron interrumpidos antes de cargar app.js; se conservan,
pero no son evidencia del fallo de regreso. El fixture final compila con Vite
en un proceso Node separado y sirve ese build; conserva logs y perfil CPU.
La primera comprobación unitaria corregida encontró tres expectativas/mocks
inexactos: el contrato anterior llama onPageReady dos veces (el host es
idempotente) y returnToShelf devuelve booleano. Corregidos esos mocks, pasan
29 casos, incluyendo una sola retirada por cancelación y un solo reader.close.

La batería completa120 aprueba **3.863 pruebas en 312 archivos** al primer
intento; el build de producción termina correctamente. Núcleo de 59.215 bytes,
SHA256 `eb5d2ff07993ef68bad27d7d94796d4eaf044582d3bd9d6b425905a6f3487776`.

También pasan las 105 comprobaciones Python/Android y los ocho recorridos
originales locales al primer intento, conservando sus plazos y aserciones.
Publicación y CI120 pendientes.
