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
