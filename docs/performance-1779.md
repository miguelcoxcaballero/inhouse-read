# Captura de PDF ya renderizado — 1.7.79

La apertura y el cierre pueden reutilizar el diseño de una página física
completada. Se comprueban documento, página, preferencias, tamaño, canvas,
texto y nodos con el mismo contrato de renderizado que ya usa el lector.
Si cambió el tamaño o se dañó ese estado, se completa su render antes de
copiar. Los snapshots siguen siendo copias nuevas con sus píxeles originales.

La opción se solicita sólo desde la preparación y el cierre de la app.
El contrato anterior por defecto conserva ambos fotogramas. El PDF adaptable
y Foliate mantienen sus esperas de fuentes y diseño; no cambian relojes de
animación, resolución, filtros, imágenes ni materiales.

Pasan 84 comprobaciones enfocadas, incluidas las originales de fonts,
captura, reutilización, persistencia local y controlador. Las cuatro nuevas
comprueban página intacta sin RAF, resize explícito, render pendiente y la
espera de dos frames del texto DOM. Con la fuente publicada anterior fallan
las tres primeras y pasa el control DOM. El primer helper conservó dos
fallos por mocks DOM incompletos; se corrigieron sólo esos nuevos mocks y
la comparación de fuente anterior se conserva separada y autenticada por Git.

La batería CPU pasa: 3.393 unitarias en 267 archivos, build y 75 pruebas
Python. El censo mantiene 524 casos E2E, todavía sin ejecutarlos en esa tanda.
Los 643 archivos de código, tests y configuración permanecen idénticos antes
y después. La publicación sigue pendiente. Evidencia:
`.animation.local/performance-1779/`; los primeros informes de mocks están
en `.animation.local/performance-1778/snapshot-settled-*`.

El primer lanzamiento gráfico se detuvo en Windows PowerShell 5 por una
advertencia de stderr antes de ejecutar casos. Se conserva su directorio,
log vacío y recibo del launcher. La ejecución separada utiliza PowerShell 7,
sin cambiar tests, fixtures, límites, renderer ni añadir retries.

Los siete recorridos locales pasan en ese primer lanzamiento efectivo,
sin retries ni omisiones. Los cierres nativos completos tardan 4.839,2 y
5.329,1 ms dentro de su límite original de 8 s. Código, build y métodos
permanecen idénticos. Pasan además los cinco casos originales de catálogo,
plantas y luces, sin retries. Pasan las dos regresiones originales adicionales
de continuidad de canvas y efecto de lámparas. Publicación y CI original
completo siguen pendientes. Estos tiempos no son un benchmark de
teléfono ni prueban una mejora frente a otra ejecución en distinta carga.

Publicada desde `9ef03cb` en Pages `de9b42e`; main `main-DzaFVSdW.js`,
SHA256 `76e5cf894072d1de14bb3ea892e8f4d4be3880605cf9bd1b2bff1b7ea8522b5e`.
HTTP32/offline96 y APK descargado/loader exacto PASS. Android sigue en
1.1.4/code17: esta entrega cambia sólo la web. La primera comprobación del
índice vio la versión anterior durante propagación y se conserva separada.

La tanda pública original de tres conserva 2 PASS y un FAIL de auditoría:
la textura walnut devuelve status 200 con cuerpo vacío durante una navegación,
aunque las aserciones funcionales de ambos regresos nativos y del editor
pasan. No se modifica ni relaja ese fixture, ni se cuenta la tanda como PASS.
Se conservan log, informe y traza.

Los 18 PDF públicos pasan sin retries, con auditoría de 590 cuerpos y
15 capturas. Papel offline original PASS en cinco temas. La comparación
adicional default/reuseSettledLayout produce exactamente los mismos píxeles
de tema y papel blanco en los cinco temas, dimensiones 393×786, copias
nuevas y las mismas identidades de raster; cero readbacks en el hilo
principal. Se ejecuta el PdfReader publicado y su worker real desde el
service worker, sin sustituir respuestas de la app. Portada publicada
offline PASS: JPEG 800×1600, 150.310 bytes, cero fallback. Pasan los cinco
casos públicos de catálogo/plantas/luces, sin retries, con fuente y hash
publicado idénticos antes y después. CI global original sigue pendiente;
UI3 ya conserva FAILED: cierres originales a 8 s y un fallo de primer frame
en el segundo intento de 393 px, además de lámparas flaky. El log original
de su job se conserva en `ci-original-37398555498-attempt1/`.

La recogida completa posterior conserva CI `37398555498` FAILED: 11 ZIP
y 12 logs autenticados, 524 identidades/528 intentos, cuatro retries/seis
intentos fallidos, cero incidencias de recogida. Unitarias y las cuatro
tandas de voces PASS; UI1/2/4/5 PASS. UI3 conserva cierres a 8 s, un fallo
distinto de primer frame en el retry de 393 px y lámparas flaky. UI6 conserva
el primer frame de tres luces fallido y su retry PASS, rechazado por el
guard original. No se convierte en una aprobación global.
