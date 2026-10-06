# Continuacion: web1.7.99 preparada / Android1.1.7 publicado

Web1.7.98:27/27 publicos estrictos,10 locales originales y tres recorridos
offline PASS. Se conservan todos los fallos anteriores; CI original98
sigue pendiente. APK1.1.7/codigo20 real, firma y loader2107B verificados;
audio bloqueado mas de6min y23 capitulos PASS en emuladorAndroid15.
1.7.99 conserva titulo y autor editados al revelar el lector precargado.
Reproduccion3PASS/1FAIL antes y4PASS despues; bateria3.512/288, build y
92 Python PASS. Original E2E/publicacion/verificacion99 pendientes.
No se declara resuelta toda la lentitud: CI97 conserva tiempos globales
30s y cierre8s fallidos. Hay que revisar sus trazas originales.
[1.7.98](performance-1798.md), [1.7.99](performance-1799.md).

# Continuación: web1.7.98 preparada / Android1.1.7 publicado

Web1.7.97 publicada y contrastada con HTTP32/shell96, nueve recorridos
locales originales, offline con fotos/bytes/posición115 y portada800x1600.
Tanda pública24/26 estrictos: dos fallos de auditoría de textura vacía
quedan conservados. APK1.1.7 descargado, firma/loader2107B y manifiesto20
verificados; audio bloqueado más de6min/23 capítulos en Android15 PASS.
CI completa de1.7.97 pendiente. La traza del gesto del editor revela una
pestaña distinta bajo un encabezado invisible;1.7.98 enlaza el encabezado
con la pestaña activa visible.49 comprobaciones enfocadas PASS; batería
completa3.508/287, build y92 Python PASS; gesto original con SwiftShader
PASS sin retries ni cambios del límite2.200ms. Publicación en curso.
[1.7.97](performance-1797.md), [1.7.98](performance-1798.md).

# Continuación — web 1.7.97 / Android 1.1.7 en construcción

Se agilizan las fases de apertura y cierre: apertura programada de 1.820 a
1.380ms y regreso al hueco de 1.929,6 a 1.529,6ms. Batería local:
3.505 unitarias/286 archivos, build y92 Python PASS. Censo526 sin skips,
todavía no ejecución completa. Geometría, texturas y límite de pasos
permanecen idénticos. Android1.1.6 real está verificado;1.1.7/código20
corrige el final del audio tras una pausa de planificación larga.
Recorridos originales, web/offline, CI completa y APK20: pendientes.
[Detalle y alcance](performance-1797.md).

# Continuación — web 1.7.96 / Android 1.1.6 preparado

Se integran los cambios EPUB/audiolibro de d2e9295 y 5f43d04. Se corrige
el retraso de audio Android que podía impedir completar el último fragmento
y que sobrevivía a un reset/flush. Batería local: 3.499 unitarias/285 archivos,
build y 91 Python PASS. Censo526 sin skips, todavía no ejecución completa.
APK1.1.5 real y firma/loader verificados;1.1.6/código19 requiere su build.
Web/API públicas y CI de la nueva fuente están en comprobación.
No se declara resuelta toda la lentitud: dos aperturas nativas8s fallan en
la CI anterior; también se conserva un cierre SwiftShader fallido.
[Detalle y alcance](performance-1796.md).

# Verificación en curso — web1.7.94 y Android1.1.5 preparado

Se integra la web1.7.93 de GitHub antes del cambio de caché del estudio.
Pasan 3.493 unitarias/284 archivos, build, 84 comprobaciones Python,
18 pares RGBA exactos, atlas de producción idéntico al recargar y nueve
recorridos locales principales/regresiones sin retries. La auditoría
independiente conserva el error original de censo525 y acredita526 casos
listados: todavía no se ha ejecutado toda la nueva CI. Android1.1.5/código18
está preparado; el manifiesto conserva1.1.4 hasta que pase y se publique.
PDF/catálogo, CI completa y web/APK públicas: pendientes.
[Detalle y límites](performance-1794.md).

# Verificación del WIP — web1.7.91 publicada y Android1.1.4

## Reserva por fases 1.7.91 publicada

Libera la reserva grande después del zoom de cierre; las siguientes fases
conservan su DPR y reservas por movimiento. Pasan 3.474 unitarias/280
archivos, build, 75 Python, 18 pares RGBA, 34 recorridos locales y 26
recorridos públicos con sus auditorías, sin retries en esas tandas.
HTTP 32/shell 96, APK/loader descargados, temas y portada offline, bytes
locales y posición 115 al recargar/reabrir: PASS. Se desbloqueó Pages con
un único reenvío del árbol idéntico; se conserva la identidad fallida inicial.

CI original completa FAILED: 524 casos/526 intentos; dos casos de apertura
nativa fallan también en sus retries (cuatro intentos fallidos). El PDF no
se hace visible para la espera original de ocho segundos. Cinco UI y las
cuatro tandas de voces reales PASS. La lentitud global sigue pendiente;
no se afirma FPS móvil ni login real de Google. [Detalle](performance-1791.md).

## Reducción del framebuffer1.7.90 publicada

53 focales,3468/279 unitarias, build/75 Python,18 pares RGBA exactos y11
recorridos locales originales PASS sin retries. HTTP32/offline96, descarga
APK/loader, PDF/papel/portada en cinco temas e importación/reapertura local
con bytes y locator115 exactos PASS. Público22/26 estrictos: cuatro fallos
de cuerpo de textura observado como0; no se sustituyen por sus cuerpos
funcionales correctos ni por seis diagnósticos separados sin reproducción.
CI37439363327 completa FAILED:524 casos/527 intentos,3 retries,5 fallos
en UI3/6. Ambos cierres nativos fallan tambien al repetir; isometrica
falla primero al arrancar y pasa su retry, aun flaky rechazado. Cuatro
tandas de voces reales y otras cuatro UI PASS. [Detalle](performance-1790.md).

## Preparación de página1.7.89 publicada

La página oculta entrega su lote de shaders antes de consultar si está
preparado. Siete regresiones nuevas,35 enfocadas,3462/278 unitarias,
build y75 Python PASS. Dieciséis recorridos gráficos locales originales y
26 de la web publicada con auditorías PASS, sin retries. HTTP32/offline96,
PDF e imágenes en cinco temas, portada offline, importación y reapertura
con bytes/locator115 exactos y descarga APK/loader reales PASS.

CI37433923469 completa FAILED:524 casos/527 intentos,3 retries,5 intentos
fallidos sólo UI3. Regreso alineado supera30s; fraccionario falla al abrir
PDF8s; luces falla primero y pasa su retry, todavía rechazado como flaky.
Otras cinco UI y cuatro tandas de voces reales PASS. No se considera toda
la lentitud resuelta. [Detalle y límites](performance-1789.md).

## Guardado de progreso1.7.88

Se agrupan sólo posiciones pendientes contiguas de cada libro. La escritura
activa y los ajustes/historial respetan su orden. Cierre y apertura esperan
la posición final; los bytes siguen locales y Drive se programa tras guardar.
Siete nuevas y43 relacionadas PASS;3455 unitarias/277 archivos, build y75
Python PASS. IndexedDB real1/16MB conserva bytes/portada/progreso/ajustes:
dos commits para una escritura activa y1000 avisos pendientes. Catorce
recorridos normales, dos SwiftShader originales y reanudación EPUB PASS,
cero retries y plazos intactos. No mide FPS ni velocidad de teléfono.
Deploy, pin de los bytes HTTP32/offline96 y nueva descargaAPK/loader PASS.
Papel en cinco temas y portada offline PASS; catálogo5 PASS. Dos auditorías
públicas de texturas observadas como0 fallan: principales2/3 yPDF17/18
aprobados, aunque los cuerpos funcionales pasan. Originales conservados,
24/26 públicos aprobados,0 retries. CI nueva todavía en marcha.
[Detalle](performance-1788.md).


Un marcador existente conserva malla, material, alphaMap y buffers al guardar
progreso. Geometría, acabado y pose conservados; la primera cinta se crea como
antes. Seis nuevas y100 relacionadas PASS;3448 unitarias/276 archivos, build
más75 Python PASS. Dieciocho paresRGBA y14 recorridos normales PASS, cero
retries. SwiftShader adicional: alineado PASS, fraccionario FAIL por cierre8s.
Deploy, HTTP32/offline96, nueva descargaAPK/loader y26 recorridos públicos
con sus auditorías PASS. Papel en cinco temas y portada offline PASS.
CI completa37425792376 FAILED:524 casos/528 intentos,4 retries/6 fallos en
UI1/3/6; cuatro tandas reales de voces y las otras tres UI PASS. Fallos
originales retenidos; no resolución completa de la lentitud.
[Detalle](performance-1787.md).

## Composición de sala 1.7.86 publicada

El shader del replay de sala prepara uniforms en intervalos libres después
de la primera pintura, evitando su preparación inicial dentro del regreso.
Sin captura, dibujo ni cambios de shaders o resolución; cancelación por
propietario/contexto/generación/dispose. Seis nuevas y31 enfocadas PASS;
3442 unitarias/275 archivos, build y75 Python PASS. Tres composiciones
WebGL2 conservan cada píxel. Los14 recorridos normales, dos cierres originales
adicionales con SwiftShader y el caso de planta vecina PASS, cero retries.
Deploy y pin de los bytes públicos PASS; HTTP32/offline96 y nueva descarga
APK/loader PASS. Los26 recorridos públicos y auditorías PASS, cero retries.
Papel/portada offline PASS; CI completa524 FAILED sóloUI3:527 intentos,
3 retries y5 fallos. Las cuatro tandas de voces y otras cincoUI PASS;
no prueba de rendimiento móvil.
[Detalle](performance-1786.md).

## Preparación de la inserción 1.7.85 publicada

Los mismos programas de profundidad y del indicador preparan también sus
uniforms, uno por intervalo libre después del primer frame. Sin dibujo,
cambios de materiales/resolución/relojes ni nuevas variantes. Cancelación
por dispose y errores mantienen el dibujo normal. Seis nuevas y 30 pruebas
enfocadas PASS. Pasan 3.436 unitarias/274 archivos, build, 75 Python y
14 recorridos normales. Los dos cierres adicionales de SwiftShader pasan
en su primer intento, con plazos originales. HTTP32/offline96, nueva APK/loader y papel/portada
offline PASS. Los26 recorridos públicos y auditorías PASS, cero retries.
CI completa524 FAILED en UI3, UI4 y UI6:528 intentos/4 retries/7 intentos
fallidos, sin omisiones. Las cuatro tandas reales de voces PASS. El retry
aprobado de luz3 sigue siendo flaky rechazado por el gate original.
Aún no se da por terminado.
[Detalle](performance-1785.md).

## Diagnósticos de shaders 1.7.84 publicada

Producción evita consultas de logs sincrónicos; desarrollo y callbacks
personalizados conservan los diagnósticos. 34 pruebas enfocadas, 3.430
unitarias/273 archivos, build y 75 Python PASS. Dieciocho pares de imágenes
WebGL2 exactos; consultas de logs 30 a cero sin cambiar materiales o resolución.
Catorce recorridos normales locales PASS; dos cierres adicionales con
SwiftShader FAIL a 8 s. HTTP32/offline96, descarga nueva APK/loader y papel
más portada offline PASS. Casos públicos: recorridos 2/3, PDF 17/18 y
catálogo 5/5; dos fallos de auditoría de una textura observada vacía al
terminar casos cuyas aserciones funcionales pasaron. Los originales
fallidos permanecen registrados. CI completa524 FAILED: dos cierres en
UI3 y recarga del nogal con tres luces en UI6, también en retries. Las
cuatro tandas reales de voces PASS.
No se considera resuelta toda la lentitud. [Detalle](performance-1784.md).

## Reserva compacta de animación 1.7.83

Apertura y cierre nativos mantienen el mayor recorte necesario durante la
secuencia, creciendo sólo cuando hace falta. Once unitarias enfocadas PASS
y 18 comparaciones WebGL2 exactas. La propuesta anterior de viewport completo
se conserva descartada por dos cierres fallidos en software. Ningún plazo
original se amplía. Batería revisada: 3.424 unitarias/272 archivos, build,
75 Python y 14 recorridos gráficos PASS sin retries. Software adicional:
alineado PASS, fraccionario FAIL a 8 s. HTTP32/offline96 y nueva descarga APK/loader PASS. PDF18 y catálogo5 públicos
PASS, papel/portada offline PASS. Tres recorridos públicos: 2 PASS/1 FAIL
de auditoría por dos texturas con cuerpo0 observado; recorrido funcional
correcto y HTTP independiente aprobado no sustituyen la auditoría fallida.
CI completa FAILED: sólo UI3 falla dos aperturas nativas, también en retry.
Las cuatro tandas reales de voces pasan; no se considera terminado.
[Detalle](performance-1783.md).

## Entrega de shaders de 1.7.82 publicada

El lote completo se entrega al driver antes de consultar su preparación;
no se espera ni se modifica el renderizado. Cuatro de seis regresiones nuevas
reproducen la ausencia de entrega anterior. Pasan 24 enfocadas, 3.417
unitarias/271 archivos, build y 75 Python. Pasan siete recorridos gráficos,
cinco de catálogo/plantas/luces y dos regresiones adicionales, sin retries
ni cambios de límites o fuente durante las tandas. HTTP32/offline96, nueva
descarga APK/loader, tres recorridos públicos, 18 PDF y papel/portada offline
PASS. Cinco casos públicos de catálogo PASS: 26 recorridos públicos
aprobados sin retries. CI original FAILED en UI3/6: 524 identidades,
528 intentos, cuatro retries/ocho fallos. Dos aperturas nativas y primer
frame de lámparas tras recarga no cumplen los plazos originales;
unitarias, cuatro trabajos de voces y restantes UI PASS. Originales completos.
[Detalle](performance-1782.md).

## Origen de la estantería de 1.7.81 publicada

Cada estructura HTML conserva su propio ajuste de posición. Sustituirla
restaura la anterior y alinea la primera pintura de la nueva, conservando
el canvas y renderer. Tres regresiones reproducen el fallo anterior;
pasan 28 pruebas enfocadas, 3.411 unitarias/270 archivos, build y 75 Python.
Pasan siete recorridos gráficos, cinco de catálogo/luces y dos regresiones
adicionales, sin retries. HTTP32/offline96, nueva descarga APK/loader y
conservación exacta del atlas real al actualizar 80→81 PASS. Los 26
recorridos públicos y papel/portada offline PASS, sin retries. CI original
FAILED en UI3/6: 524 identidades/527 intentos, tres retries/seis fallos;
unitarias, todas las voces y restantes UI PASS. Censo y originales completos.
[Detalle](performance-1781.md).

## Caché de iluminación de 1.7.80 publicada

La huella automática del código 3D y de Three permite conservar el mismo
atlas entre actualizaciones del lector o app que no cambien esas entradas.
Pasan 45 pruebas enfocadas, 3.407 unitarias/269 archivos, build y 75 Python.
Pasan siete recorridos gráficos, cinco de catálogo y dos regresiones
adicionales sin retries. HTTP32/offline96 y APK/loader descargados PASS;
cinco casos públicos de catálogo, papel/portada offline y atlas real al
recargar PASS. PDF conserva 17 PASS/1 FAIL de auditoría HTTP. La tanda
gráfica pública conserva 2 PASS/1 FAIL de origen fraccionario y textura vacía.
CI original FAILED sólo en UI6: primer frame de tres luces tras recarga a
8 s, dos intentos fallidos; 524 identidades/525 intentos, voces y UI1–5 PASS.
Se mantienen píxeles, iluminación y resolución.
[Detalle](performance-1780.md).

## Captura de PDF de 1.7.79 publicada

La app reutiliza el diseño sólo para una página física completada e intacta;
un tamaño nuevo se renderiza primero. Conserva copias, píxeles y el contrato
DOM, sin cambiar relojes. Pasan 84 pruebas enfocadas, 3.393 unitarias en
267 archivos, build y 75 Python. Los siete recorridos de animación, cinco de
catálogo y dos regresiones adicionales pasan sin retries. HTTP32/offline96,
APK/loader, 18 PDF y cinco de catálogo publicados PASS. Papel default y
optimizado offline coinciden píxel a píxel en cinco temas; portada PASS.
La tanda pública de tres conserva un FAIL de auditoría de textura vacía,
aunque sus aserciones funcionales pasan. CI original FAILED en UI3/6,
524 identidades/528 intentos, cuatro retries/seis intentos fallidos;
unitarias, todas las voces y restantes UI PASS. [Detalle](performance-1779.md).

## Reserva de la sala de 1.7.78

El renderer compartido agrupa DPR y tamaño también al capturar la sala e
insertar el libro. Cinco regresiones nuevas conservan su estado final y
eliminan tres reservas intermedias. Pasan 3.389 unitarias/266 archivos, build,
75 Python, ocho comparaciones de píxeles y siete recorridos gráficos originales.
Catálogo conserva cuatro PASS y un FAIL de primer frame de luces tras recarga
a 8 s. HTTP32/offline96 y APK/loader PASS; 18 PDF, cinco de catálogo y dos
regresos nativos públicos PASS. Editor conserva un FAIL de auditoría de
textura vacía. Papel y portada offline PASS. CI original FAILED en UI3/6:
cierre nativo a 8 s y dos casos flaky tras recarga. Todas las voces reales
y restantes UI PASS; no se afirma aprobación global.
[Detalle](performance-1778.md).

## Catálogo oculto de 1.7.77

La descarga se prepara en idle sin construir su estudio GPU oculto. Pasan
47 pruebas enfocadas, 3.384 unitarias/265 archivos, build y 75 Python.
Pasan los siete recorridos de animación y cinco de catálogo/plantas/luces
sin retries. Publicación HTTP32/offline96, APK/loader y 26 recorridos
públicos PASS; papel y portada offline PASS. CI original FAILED en UI3/6:
apertura nativa y primer frame de luces; todas las voces reales PASS.
[Detalle](performance-1777.md).

## Reserva nativa del libro de 1.7.76

La vista 3D evita el framebuffer intermedio de un resize que cambia ambos
ejes. Mantiene dimensiones finales, DPR, píxeles, modelos, iluminación y
relojes. Pasan 55 pruebas enfocadas y ocho comparaciones de píxeles reales.
Pasan 3.382 unitarias/264 archivos, build, 75 Python y siete recorridos
gráficos originales sin retries. Publicación HTTP y APK/loader PASS;
21 recorridos públicos originales PASS sin retries; papel offline en cinco
temas PASS. CI original FAILED en UI2/3; voces y restantes UI PASS.
[Detalle](performance-1776.md).

## Apertura y contador de programas de 1.7.75

Preparación de uniformes de los mismos shaders mientras espera la portada,
en turnos idle, y corrección del contador publicado tras la preparación de
la estantería. Pasan 98 pruebas enfocadas en cinco archivos. Publicada e
integrada con las correcciones de lámparas y catálogo hasta `1864695`:
3.373 unitarias/263 archivos, build, 75 Python, siete recorridos locales y
21 públicos PASS, HTTP32/offline96 y APK/loader reales PASS. Papel y portada
PDF publicados funcionan offline. CI original mantiene sus fallos nativos;
no se afirma aprobación global. [Detalle](performance-1775.md).

## Texturas PDF de 1.7.74

Subida la reutilización de las texturas exactas de un mismo render PDF: no
se vuelven a generar ni a subir a GPU al cerrar si los píxeles y dimensiones
siguen siendo los mismos. Cambiar página, tema, brillo, tamaño o documento
invalida la identidad. Pasan 3.353 unitarias/262 archivos, build, 75 Python,
siete recorridos locales y 21 públicos sin retries. HTTP32/offline96,
papel offline en cinco temas, portada offline y APK/loader descargados PASS.
CI conserva los fallos originales de UI3 y UI4; no se afirma aprobación
global. [Detalle](performance-1774.md).

## Publicación combinada de 1.7.73

La fuente `2094a19` incorpora los cambios posteriores de arranque y caché de
plantas, superficies y estudio que ya habían llegado a GitHub. Pasan 3.348
unitarias/261 archivos, build y 75 Python. HTTP32/offline96 y los tres
recorridos públicos originales de editor/retorno nativo pasan. El PDF real
y su worker de papel funcionan offline en cinco temas; portada JPEG
800×1600 con encoder publicado, sin fallback, también PASS.

La tanda pública PDF conserva 17 PASS y un FAIL de auditoría HTTP: la textura
walnut cancelada durante navegación devuelve cuerpo vacío. No se cuenta como
18/18 aprobado aunque las aserciones de texto e imágenes de ese caso hayan
pasado. CI `37379044119` conserva fallos del retorno nativo y un caso flaky
de importación EPUB; no se afirma aprobación global. Las comprobaciones
offline fallidas de la fuente anterior pedían un chunk de `ba0f85f` después
de que el despliegue fuese sustituido por `2094a19`. Se conservan y se repite
la comprobación con los bytes y el índice realmente publicados, no con una
sustitución de respuestas.

Evidencia: `.animation.local/performance-1773-origin/`, subcarpetas separadas
`public-ba0f85f-attempt1` y `public-2094a19-attempt1`. No se afirma una nueva
comprobación en teléfono físico ni autenticación real de Google.

## Muestreo de papel de 1.7.73 en preparación

El worker mide el mismo margen de 12×12 píxeles con el mismo algoritmo,
sin bloquear la interfaz con getImageData. Ocho raster reales de Chromium
conservan exactamente el RGB o la decisión null del muestreo original;
no hay readbacks en el hilo principal. Navegación, brillo y cierre durante
el muestreo invalidan o cancelan el resultado. Se conservan resolución,
materiales, iluminación, modelos y relojes. Pasan 3.292 unitarias/255
archivos, build y 75 Python. Pasan siete recorridos gráficos originales
sin retries u omisiones; cierres completos de 5.179,6/5.217,9 ms.
Se integran cambios nuevos de GitHub (`06f0f5e`) sobre arranque y menús;
corregido el ciclo de vida del arranque, la fuente combinada pasa 3.303
unitarias/257 archivos, build y 75 Python sin errores sin capturar. Sus
siete recorridos conservan 6 PASS y un fallo de alineación al quitar
el encabezado. Corregido el origen del escenario, pasan ambos contratos
nativos originales. La batería final y las comprobaciones públicas
siguen pendientes. Detalle en [Muestreo de papel de 1.7.73](performance-1773.md).

## Tono de página de 1.7.72

El modelo reutiliza sólo la medición del margen para copias del mismo
raster PDF completado, con dimensiones y filtro idénticos. Se invalida
al navegar, renderizar, cambiar tema, zoom, brillo, tamaño o cerrar.
La copia de los píxeles y su calidad permanecen iguales; no se conserva
otro bitmap. Pasan 3.265 unitarias/254 archivos, build, 75 Python y siete
recorridos gráficos originales sin retries u omisiones. Cierres completos:
5.721,2/4.738,0 ms, dentro de 8 s. Publicada desde `1c7242e`: HTTP26/offline90,
APK/loader reales, tres recorridos públicos de editor/nativo y 18 PDF PASS.
El lector/encoder publicados funcionan offline sin fallback. CI72
`37302341505` termina FAILED: 12 jobs y 11 ZIP originales, 524 identidades
y 526 intentos; sólo UI3 y el agregado fallan. Las trazas conservan
los dos timeouts de apertura y el cierre truncado del segundo intento
fraccional. No se afirma PASS global ni FPS de un teléfono. Detalle en [Tono de página de 1.7.72](performance-1772.md).

## Portadas PDF de 1.7.71

La lectura y codificación JPEG de la portada se trasladan a un worker
cuando el navegador lo admite. Se conserva la calidad .9, el raster y
las dimensiones; hay cancelación y fallback al encoder original. Cuatro
portadas reales producen exactamente los mismos bytes JPEG en Chromium.
Pasan 3.252 unitarias/254 archivos, build, 75 Python y los siete recorridos
gráficos originales sin retries ni omisiones. Cierres: 4.830,6/5.482,3 ms.
Publicada: HTTP26/offline90, APK/loader reales, tres recorridos públicos
nativo/editor y 18 PDF PASS. El lector PDF genera su portada con el worker
publicado sin Internet y sin fallback. El diagnóstico SwiftShader/CDP
mantiene un fallo fraccional de cierre; CI71 queda sellado FAILED con
12 jobs, 11 ZIP y 524 identidades/526 intentos, sólo UI3 y agregado fallidos.
Detalle en [Portadas PDF y rendimiento de 1.7.71](performance-1771.md).

## Reserva del encuadre de 1.7.70

Las animaciones reservan su encuadre compacto antes de empezar, evitando
redimensionar el framebuffer al cruzar cada bucket. Se conservan calidad,
DPR, modelos, materiales, geometría, sampler y relojes; la reserva puede
crecer y se libera al cancelar o terminar. Pasan 79 pruebas enfocadas,
3.235 unitarias/253 archivos, build, 75 Python y los siete recorridos
originales al primer intento. Cierres completos: 5.555,7/5.339,2 ms dentro
de sus 8 s. No se afirma una mejora medida de FPS en un teléfono.
Publicada: HTTP25/offline89, APK/loader reales, tres recorridos públicos
nativo/editor y 18 PDF PASS. CI70 completo queda sellado FAILED: 12 jobs,
11 ZIP y 524 identidades/526 intentos; sólo UI3 y el agregado fallan.
No se afirma aprobación completa. Detalle en
[Animaciones y rendimiento de 1.7.70](performance-1770.md).

## Reutilización HDR de 1.7.69

El segundo renderer reutiliza el atlas completo del estudio mediante una
transferencia asíncrona opcional. Mantiene reflejos, resolución y relojes,
con fallback a la generación original. Pasan 3.232 unitarias/253 archivos,
build y 75 Python; la prueba gráfica integrada conserva exactamente el HDR
y todos los píxeles en tres ángulos. Pasan los siete recorridos originales:
cierres nativos completos de 4.908,1 y 5.303,4 ms, sin retries ni omisiones.
Publicada: HTTP25/offline89 y APK/loader comprobados, tres recorridos
públicos nativo/editor y 18 PDF PASS, más fuentes offline exactas. Android
emulado `37293604213` acredita preflight de Google y cinco estados de
política nativa; su última captura conserva el libro en tránsito y no mide
el fin visual del cierre. CI69 `37292891253` acaba FAILED: UI3 falla y UI1 supera el límite del job
de 45 minutos, sin artefacto. No hay censo completo de 524 casos acreditado.
Detalle en [Iluminación y rendimiento de 1.7.69](performance-1769.md).

## Fuentes locales de 1.7.68

Se conservan los 34 archivos originales, siete familias y 93 caras CSS.
La tipografía se sirve desde la app y entra en el shell offline junto con
sus licencias; Playfair se precarga desde el mismo asset CSS.
Pasan 3.213 unitarias/252 archivos, build, 75 Python y los siete
recorridos gráficos originales. Fuentes online/offline con raster y cuerpos
exactos comprobados. Publicada: HTTP25/offline89 y APK/loader reales
comprobados, más 18 PDF públicos y fuentes offline. El público fraccional
conserva su fallo global30. CI68 completo queda sellado FAILED: 12 jobs,
11 ZIP y 524 identidades; UI2/UI3 y el agregado fallan, el resto pasa.
No se afirma aprobación completa. Detalle en
[Fuentes y rendimiento de 1.7.68](performance-1768.md).

## Cambios de rendimiento de 1.7.67

La sala de dimensiones fraccionarias permanece en WebGL y evita copiar
sus píxeles a Canvas2D en cada repintado. Conserva modelos, materiales,
DPR y animaciones; mantiene exports bajo demanda y fallback real. El
contrato gráfico de 393 px migra explícitamente; sus fixtures y plazos
30/8 no cambian. Pasan 116 unitarias enfocadas, build y los siete
recorridos gráficos al primer intento, sin retries u omisiones. Los dos
cierres completos quedan en 5.699,9/5.226,4 ms; fuente/build estables.
Batería local completa PASS: 3.208 unitarias/251 archivos, build y 75 Python.
Web publicada: 21 recorridos PASS; HTTP25/offline46 y APK/loader comprobados.
CI67 completo queda sellado FAILED: las 524 identidades están ejecutadas;
UI3 y el agregado fallan, los demás grupos pasan. Sin reintentar ni
reclasificar el original. Detalle en
[Rendimiento de 1.7.67](performance-1767.md).

## Cambios de rendimiento de 1.7.66

El toque breve evita el microlift 3D previo y su repintado completo; el
levantamiento y el arrastre tras mantener pulsado conservan sus 440 ms.
Las texturas de madera existentes empiezan a descargarse desde el HTML,
con el mismo CORS y archivos que utiliza Three.js. Modelos, materiales,
resolución y relojes de animación permanecen iguales.

Los 119 casos enfocados del runtime pasan, pero su primer comando falla al
coleccionar una nueva prueba de precarga. Corregida sólo esa lectura, las
dos primeras baterías completas conservan timeouts originales de 5 s.
El diagnóstico separado de ambos archivos afectados pasa 30/30; el matcher
de PCM pesa casi cinco segundos y se prepara una batería con menor
concurrencia. La batería posterior con un worker pasa 3.193 unitarias,
build y 75 Python. Publicación HTTP25/offline46 y APK/loader comprobadas;
18 PDF públicos PASS. Los siete locales conservan cinco PASS/dos timeouts
global30; los tres públicos conservan editor PASS y ambos nativos FAILED
por el plazo global. No miden cierres aislados completos de ocho segundos.
CI66 completa queda FAILED en UI3 y el agregado; los demás jobs pasan.
La colección de 12 jobs/11 ZIP/524 identidades queda sellada FAILED;
no se reintenta la ejecución.
Detalle en [Rendimiento de 1.7.66](performance-1766.md).

## Cambios de rendimiento de 1.7.65

La transferencia nativa de modelos cede mediante el executor existente;
la captura física PDF evita esperar fuentes ajenas ya rasterizadas; el
analizador autocontenido conserva el scorer y carga el cliente Worker al
comenzar. La fuente final pasa 3.175 unitarias/246 archivos, build y 75 Python,
con 530 hechos estables; 524 identidades E2E son sólo censo, sin ejecución.
Recibo completo `88975ced…`. Los siete locales y el RAW original pasan al
primer intento, sin retries, flaky u omisiones, fuente/build estables;
recibos `c2e0233a…` y `7e570ba6…`. Cierres de 5.357,7 y 6.299,9 ms en software
con los ocho segundos originales, sin comparación de velocidad física.

El Worker real conserva cuatro comparaciones online/offline, 432 scores y
bytes de muestras/máscaras/apariencias exactos. Cliente y Worker offline
llegan 200 del Service Worker con cuerpos exactos; sin errores inesperados,
entradas estables y procesos cerrados; informe `c946b0d6…`. Se conserva el
primer resumen nativo FAILED y su auditoría separada sin nuevas pruebas,
así como el helper RAW2 rechazado sin ejecución por recodificación UTF-8.
La publicación HTTP/APK/loader está comprobada; los 18 PDF públicos y el
RAW original pasan. En los tres públicos, el editor pasa y los dos de
devolución fallan por global30, sin acreditar un cierre completo superior
a ocho segundos. El diagnóstico pasivo posterior conserva ese fallo:
editor y legado pasan; alineado termina por global30. Las copias lentas
del legado pertenecen al fallback de la estantería, no a la captura PDF.
Antes de leer hubo cuatro repintados iniciales y dos de selección; también
hubo dos al cerrar. No se acredita todavía la fluidez del teléfono.
La primera prueba Android falló en el verificador antes de iniciar audio;
una nueva ejecución corrige sólo sus rutas. El APK publicado pasa ambos
recorridos en emulador: Lessac y Cori, más de seis minutos bloqueados,
continuidad de capítulos, PDF oculto y controles del sistema. Fuente,
Pages, APK y loader exactos antes y después; resumen `3d0bfc48…`.
No mide fluidez ni temperatura de un teléfono físico.
CI65 completa queda FAILED: 522 de524 identidades pasan, dos unexpected,
526 intentos y cuatro timedOut, sin omisiones ni flaky. Los cuatro fallos
nativos ocurren antes de Volver, esperando el canvas PDF visible; no
demuestran un cierre completo superior a ocho segundos. Unitarias y todos
los grupos de voces reales pasan. Certificado `9850fb22…`.
No reclasifica los estados originales anteriores. Detalle en
[Rendimiento de 1.7.65](performance-1765.md).

## Cambios de rendimiento de 1.7.64

El cierre cancela el calentamiento pendiente de voces antes de esperar la
captura de página. Invalida el cliente, su caché PCM y temporizador; Android
encola la limpieza nativa sin bloquear JavaScript. Una continuación antigua
no puede iniciar modelos después del cierre ni sustituir una reapertura.
Pausar, detener y escuchar con la pantalla apagada conservan sus contratos.
CPU aislada: candidato155 PASS (142 originales y 13 nuevos), control142 PASS,
mismas identidades originales y cero errores no capturados; recibo `4ceb2156…`.

La adopción original rechazó mixedEOL antes de escribir y la primera batería
rechazó la versión antes de ejecutar comandos o QA; ambos errores quedan
conservados. Adopción revisada correcta, diez archivos y QA original intacta.
Batería completa real en `full-local-attempt2`: 3.147 unitarias/242 archivos,
build y 75 Python PASS; cinco comandos exit0, 526 hechos estables. Recibo
`5f4f9d99…`; 524 identidades E2E sólo censo, sin omisiones ni ejecución.
Los siete locales originales pasan al primer intento, siete intentos y
cero retries, flaky u omisiones; fuente/build526 estables, recibo `9fc0ef86…`.
Cierres de 5.349,8 y 6.144,4 ms con los ocho segundos originales. Publicada
desde `72a785c`, Pages `2423322`: HTTP24/45 PASS, artefacto `6e286ff4…`; APK
recién descargada idéntica a la firmada 1.1.4/code17 y loader2.089 bytes PASS.
Los tres públicos originales y los 18 PDF pasan al primer intento, sin
retries, flaky u omisiones, con 53 y 326 cuerpos autenticados. Certificados
`39693f80…` y `a13208dd…`. CI64 completa queda FAILED: 524 identidades,
528 intentos, siete intentos fallidos y cuatro retries. Conserva los fallos
del import RAW, los recorridos de devolución y la preparación isométrica
intermitente; no usa sus retries como aprobación. Certificado `a753ada9…`.
No acredita FPS o memoria física ni reclasifica fallos originales previos. Detalle en
[Rendimiento de 1.7.64](performance-1764.md).

## Cambios de rendimiento de 1.7.63

La puntuación numérica de máscaras de fuentes pasa a un Worker de módulo;
fuentes, rasterizado, muestreo, color y selección siguen en el hilo principal,
con el cálculo y fallback originales. CPU aislada final: candidato77 PASS
(52 originales y 25 nuevos), control52 PASS, identidades originales iguales.
Los fallos anteriores del reporter y los cuatro fixtures nuevos de realm,
además del guard de caché, quedan FAILED y conservados.

El Worker construido realmente compara dos portadas online y offline:
432 puntuaciones exactas, mismos bytes de muestras/máscaras y apariencia
final. La navegación y el Worker offline llegan 200 desde el Service Worker
con cuerpos auténticos. El primer método offline conserva FAILED; el método
fresco sólo clasifica el probe exacto de red de la raíz y exige esas pruebas
de cuerpos. Cero pageErrors, consoleErrors y fallos de red inesperados;
navegador/preview cerrados. CPU `51b39203…`, informe real `1b4e9ec6…`.

La fuente final pasa 3.134 unitarias en 239 archivos, compilación y 75
Python, con los cinco comandos exit0 y 523 hechos estables. Recibo completo
`79947b70…`. El censo conserva 524 identidades únicas E2E sin omisiones ni
intentos ejecutados; un listado no cuenta como ejecución. Los siete
recorridos locales originales pasan al primer intento, sin retries, flaky ni
omisiones; fuente/build estables. Cierres de 5.265,9 y 6.056 ms con los ocho
segundos originales; recibo `f9d6f3b1…`. Publicada desde `f81d3a1`, Pages
`774af05`: HTTP de 24 módulos/45 offline PASS, artefacto `80fe4905…`; APK
recién descargada idéntica a la firmada 1.1.4/code17 y loader de 2.089 bytes
PASS. Los tres públicos originales y los 18 PDF pasan al primer intento,
sin retries, flaky ni omisiones, con 53 y 324 cuerpos autenticados.
Certificados `1d903624…` y `a384e4a2…`. La CI original `37256218542`
termina FAILED y conserva doce logs y once ZIP completos: 524 identidades,
527 intentos, tres retries y seis fallidos; 521 expected, tres unexpected,
sin flaky ni omisiones. UI2 falla dos veces por la importación relativa
`./font-score-core.js` desde `data:`; UI3 conserva cuatro fallos durante el
cierre. El primer alineado queda truncado por el global30; no todos los
intentos acreditan una espera backend completa de ocho segundos.
Certificado `5967c0e9…`. La lectura de render `afd65c7a…` conserva los dos
legados en `returning`/`reused` en snapshots posteriores al fallo, sin medir
el fin del cierre. Las últimas respuestas de fuentes terminan más de 18
segundos antes de Back; no hay causa GPU o de `fonts.ready` demostrada.
El perfil pasivo sigue HOLD, sin ejecución. No acredita FPS, temperatura,
menor tiempo total del matcher ni píxeles del modelo 3D. Detalle en
[Rendimiento de 1.7.63](performance-1763.md).

## Cambios de rendimiento de 1.7.61

La terminación del análisis de portada utiliza el modelo ya cargado en vez
de sustituirlo completo. Los 48 pares gráficos en DPR2 y DPR1,5 conservan
RGBA completo y PNG nativo/exportado exactamente iguales; en ese punto se
observa una sustitución del control y ninguna del candidato. CPU aislada:
20 PASS (11 originales, 9 nuevos); el primer fallo de fixtures y los dos
fallos esperados del control quedan conservados. Fuente final: 3.109
unitarias en 235 archivos, build y 75 Python PASS, 515 hechos estables.
El censo de 524 E2E no se presenta como ejecución. Los siete recorridos
locales originales pasan al primer intento, sin retries/flaky/skips, con
cierres de 5.058,1 y 6.003,5 ms. Publicada desde `de672fd`, Pages `8daed16`:
HTTP real de 23 módulos/44 offline y APK recién descargada/loader PASS. Los
tres recorridos públicos originales y los 18 PDF pasan al primer intento,
sin retries, flaky ni omisiones, con 50 y 310 cuerpos autenticados. La
CI original `37254356739` termina FAILED y conserva su colección completa
sellada: doce logs, once ZIP autenticados, 524 identidades y 526 intentos,
con dos retries y cuatro fallos originales de UI3; los otros diez grupos
pasan. El primer alineado agota el plazo interno de ocho segundos esperando
`is-closing-reader`; su retry y los dos legados agotan el global de treinta
segundos sin completar la comprobación. Certificado `334e52bf…`. No se
atribuye la causa al cambio de 61 ni se reclasifican estos fallos o los de
1.7.60. No acredita FPS en un teléfono físico. Detalle en
[Rendimiento de 1.7.61](performance-1761.md).

## Cambios de rendimiento de 1.7.60

El editor agrupa la actualización de portada y canto antes de presentar el
modelo. En 64 operaciones reales pasa de dos repintados síncronos a uno, con
RGBA completo y PNG nativo/exportado idénticos. No reduce calidad ni altera
los plazos del editor. CPU aislada: 194 PASS, incluidos 176 originales y 18
nuevos. El primer fallo de datos de tres fixtures nuevos queda conservado.
Batería completa: 3.100 unitarias en 233 archivos, build y 75 Python PASS,
con 513 hechos estables y 524 identidades E2E intactas. El listado no es
una ejecución. Los siete recorridos locales originales terminan 5 PASS/2 FAIL,
sin retries, flaky ni omisiones: la carga y apertura consumieron gran parte
del límite global de treinta segundos. Aunque llegaron al lector y se emitió
Back, no quedó un presupuesto completo para medir sus cierres de ocho segundos.
No se atribuye la causa a un callback de portada
sin medirlo ni se acredita fluidez de un teléfono físico. Publicada desde
`e86279a`, Pages `937a49a`: HTTP real de 23 módulos/44 offline y APK recién
descargada/loader PASS. Primer HTML previo de CDN FAILED conservado. Tres
recorridos públicos originales: 2 PASS/1 FAIL (alineado global30), sin retries,
flaky ni omisiones; auditor estricto FAILED. Los 18 PDF públicos pasan al primer intento, sin retries ni omisiones,
con 310 cuerpos autenticados; CI original `37252194562` termina FAILED (UI3/agregador; otros diez jobs PASS).
UI3 temprano conserva 40 identidades/42 intentos, 38 pases y los dos contratos
nativos timedOut en sus cuatro intentos. Colección completa sellada FAILED:
doce logs, once ZIP autenticados, 524 identidades únicas y 526 intentos,
incluidos los dos retries y cuatro fallos originales; certificado `adf8e70c…`.
Detalle en [Rendimiento de 1.7.60](performance-1760.md).

## Cambios de rendimiento de 1.7.59

El canvas nativo del libro evita reiniciar una dimensión que ya coincide
cuando la otra realmente cambia. Three conserva tamaño, densidad y viewport;
los casos sin las condiciones del camino nativo mantienen su operación
original. No se reducen modelos, texturas, sombras ni antialiasing.

La fuente final pasa 3.082 unitarias en 231 archivos, build y 75 Python,
con 511 hechos estables. La CPU aislada final pasa 82 casos: 59 originales
y 23 nuevos. Su primer fallo de datos de una expectativa nueva se conserva.
Los siete recorridos originales locales pasan al primer intento, sin retries,
flaky ni omisiones. Cierres: 5.176,8 y 5.639,3 ms con los plazos originales.
Veinte composiciones de cámara no repintan la sala y conservan seis lomos
de 1.024 px. El censo de 524 E2E no cuenta como ejecución.

La comparación gráfica pasa al primer intento: 64 pares exactos RGBA y
PNG nativo/exportado. En 32 cambios de una sola dimensión, las dos
asignaciones originales pasan a una. El navegador y servidor quedan cerrados.
Publicada desde `ebffb33`, Pages `68f8edf`: HTTP real, APK recién descargada
y loader de 2.089 bytes PASS. Los 21 recorridos públicos originales pasan
al primer intento, sin retries, flaky ni omisiones. El primer pin HTTP de
propagación conserva su fallo y cuerpo de 1.7.58. La CI original `37249480029`
termina FAILED con dos casos de apertura en UI3 y sus reintentos; conserva
doce logs, once ZIPs, 524 identidades y 526 intentos originales. Los pases locales
y públicos no sustituyen ese resultado ni acreditan FPS de un teléfono. Detalle en
[Rendimiento de 1.7.59](performance-1759.md).

## Cambios de rendimiento de 1.7.58

La estantería pausa sus repintados después de pintar realmente el hueco
vacío del libro seleccionado. Conserva los cambios pendientes y reanuda
antes de devolverlo. Fuentes ya cargadas después del primer dibujo no
provocan otra reconstrucción. Las pulsaciones aceptan la biblioteca actual
antes de abrir el libro y conservan los gestos originales.
CPU combinado final: 246 PASS, incluidos 191 originales y 55 nuevos;
el control pasa los 191 originales y conserva 32 fallos nuevos. Los seis
casos del helper nuevo sólo se ejecutan en el candidato. La primera CPU
FAILED por dos expectativas nuevas de timing táctil queda conservada.
Fuente final: 3.059 unitarias en 230 archivos, build, 75 Python y 509
hechos estables. Censo original de 524 E2E; listado no ejecutado.
Los siete recorridos locales originales pasan al primer intento, cero
retries, flaky u omisiones. Cierres: 5.371,7 y 5.917,5 ms con sus ocho
segundos originales intactos. Veinte composiciones isométricas sin
repintar sala, dos escrituras de buffer y seis lomos de 1.024 px.
Publicada desde `0edc6b1`, Pages `ed614d2`: HTTP real, APK recién descargada
y loader PASS. Los 21 recorridos públicos originales pasan al primer
intento, sin retries ni flaky. CI original `37246413733` termina FAILED:
524 identidades, 526 intentos, dos unexpected en UI3 y cuatro intentos
fallidos antes de Back esperando PDF visible. Dos retries, cero flaky ni
omisiones; 12 logs y 11 ZIP completos. No se acredita fluidez en teléfono
ni resolver esos timeouts sólo con los pases locales y públicos.
Detalle en [Rendimiento de 1.7.58](performance-1758.md).

## Cambios de rendimiento de 1.7.57

Publicada y verificada localmente y contra la web real; CI original FAILED.
Las confirmaciones de metadatos conservan el árbol de la estantería cuando
todos los datos visibles son idénticos. La cola real pasa de una pintura
de sala/base/snapshot a cero, con referencias actuales y los mismos modelos.
Pasan 75 casos aislados, 32 pares PNG nativos y 100 pares RGBA/exportPNG
exactos en cuatro perfiles, sin cambiar calidad ni plazos. La fuente final
pasa 3.004 unitarias en 223 archivos, build y 75 comprobaciones Python;
conserva 501 hechos de fuente y las 524 identidades E2E originales.
Los siete recorridos locales originales pasan al primer intento, sin
retries, flaky ni omisiones. Cierres: 7.034,4 ms alineado y 6.140,6 ms legado,
con ocho segundos originales y global de treinta segundos intactos.
El primer full root conserva FAILED antes de ejecutar comandos por el JSON
de versión del auxiliar; su reparación sólo restaura la comilla faltante.
La batería completa PASS corresponde al intento 2. Los fallos aislados
anteriores conservan sus propios recibos. No hay medición de FPS en teléfono
ni causa demostrada del timeout de apertura o del clic perdido de CI56.
HTTP real, APK recién descargada y loader PASS; los 21 recorridos públicos
originales pasan al primer intento, sin retries ni flaky. Fuente `4899d86`,
Pages `f0ca599b`. CI original `37244969983` FAILED: 524 identidades,
526 intentos, dos retries y cuatro intentos fallidos sólo en UI3;
12 logs y 11 ZIP completos. Alineado inicial y los dos legados fallan la
espera PDF de ocho segundos. Alineado retry llega al cierre y agota el
global de treinta; no se atribuyen los cuatro fallos al cierre.
Detalle en [Rendimiento de 1.7.57](performance-1757.md).

## Cambios de rendimiento de 1.7.56

Publicada, con CI original completa FAILED: la devolución del
libro sobre la estantería legada evita una segunda copia de pantalla por
fotograma compatible. Pasan los 59 casos aislados del candidato y 26 pares
gráficos exactos en ambas densidades; las seis poses compatibles de cada
densidad pasan de doce copias a seis. No cambia la calidad visual ni los
plazos. La fuente final pasa 2.989 unitarias en 220 archivos, build y 75
comprobaciones Python; conserva las 524 identidades del censo original y
497 hechos de fuente. El listado no cuenta como ejecución de navegador.
Los siete recorridos locales originales pasan al primer intento, cero
retries, flaky u omisiones. Cierres alineado y legacy: 4.286,3 y 6.134,5 ms
con los plazos originales intactos; veinte composiciones del gesto sin
nuevos renders de sala y seis lomos de 1.024 px.
La web publicada pasa HTTP y los 21 recorridos originales de editor,
regreso y PDF al primer intento, cero retries, flaky u omisiones. APK recién
descargada y loader PASS. El primer pin HTTP de propagación permanece FAILED.
La CI original de fuente `b07aa6c`, run `37239526267`, termina FAILED:
524 identidades, 521 expected, dos unexpected y un flaky; 527 intentos,
cinco timedOut y tres retries, cero omisiones. Se conservan doce logs y
once ZIP completos. Los cuatro intentos de UI3 fallan durante apertura PDF
antes de Back, con último snapshot en zooming; no acreditan un fallo del
plazo de cierre. UI6 conserva el primer timeout global de 90.626 ms
esperando Editar y su retry PASS de 32.679 ms como flaky, sin causa del clic
perdido demostrada. Los pases locales y públicos no sustituyen esos fallos.
Se conservan separados los fallos del wrapper CPU y del primer
método gráfico. No es una medición de fluidez en teléfono ni una solución
acreditada para los timeouts de apertura de CI55.
Detalle en [Rendimiento de 1.7.56](performance-1756.md).

## Cambios de rendimiento de 1.7.55

La devolución evita dibujar y copiar la página antigua en un host desconectado
antes de actualizar el marcapáginas. Pasan 130 casos funcionales aislados y
16 pares RGBA/PNG exactos en ambas densidades. La fuente final pasa 2.980
unitarias en 219 archivos, build y 75 comprobaciones Python. El censo original
mantiene 524 E2E; el listado no se cuenta como ejecución. Los siete recorridos
locales originales pasan al primer intento; cierres 4.369,5 y 6.109,5 ms dentro
de los plazos originales. La web publicada pasa los 21 recorridos públicos
originales al primer intento, HTTP, APK recién descargada y loader. El primer
pin de propagación del HTML conserva FAILED en un namespace separado.
La CI original de la fuente `636aecb`, run `37236962479`, termina FAILED:
522 expected y dos unexpected entre 524 identidades, 526 intentos, cuatro
fallidos y dos retries, cero flaky u omisiones. Se conservan sus doce logs
y once ZIP. Los contratos nativos fallan durante apertura antes de Back;
tres fallos de selección consumen su espera completa de ocho segundos.
El reintento alineado pasa selección y falla durante apertura del PDF,
con último snapshot en zooming. No se mide ningún plazo de cierre en esas
trazas, ni se sustituye el fallo por los pases locales o públicos.
Los fallos de métodos y versiones anteriores conservan su propio estado.
Detalle en [Rendimiento de 1.7.55](performance-1755.md).

## Cambios de rendimiento de 1.7.54

El cambio de color de maceta conserva el modelo, geometrías, materiales y
encuadre tanto en estantería como catálogo. Pasan 107 casos funcionales y 160
pares gráficos exactos en ambas densidades. La fuente está incorporada y su
batería final pasa 2.972 unitarias en 217 archivos, build y 75 comprobaciones
Python y siete recorridos locales originales al primer intento. Sus cierres
nativos registran 4.925,6 y 6.133,1 ms con los plazos originales intactos.
Publicada: 1.7.54, con HTTP, APK/loader y 18 recorridos PDF públicos PASS.
Los tres recorridos públicos de editor/regreso conservan FAILED: editor pasa,
alineado termina el cierre dentro de ocho segundos pero agota el global de
treinta segundos después, y legacy incumple el plazo completo de cierre.
La CI original conserva FAILED: 522 expected y dos unexpected entre 524
identidades, 526 intentos, cuatro fallidos y dos retries, sin flaky u
omisiones. UI3 conserva cuatro fallos durante apertura antes de Back;
los doce logs y once ZIP originales se conservan. Estos ámbitos
permanecen separados de los siete recorridos locales PASS.
Ámbitos y controles en [Rendimiento de 1.7.54](performance-1754.md).

## Cambios de rendimiento de 1.7.53

La apertura reutiliza la página ya pintada sólo con pose, snapshot, revisión,
owner y contexto vigentes. Los estados que necesitan actualizarse mantienen
el render original. Pasan 189 casos funcionales aislados y 30 pares gráficos
exactos en ambas densidades, con 30 → 20 draws en el oráculo. La fuente ya está
incorporada y pasa 2.910 unitarias en 214 archivos, build y 75 comprobaciones
Python y siete recorridos locales originales al primer intento. Sus cierres
nativos registran 4.638,7 y 6.147,8 ms con los plazos originales intactos.
La web publicada pasa HTTP, APK recién descargada, loader y los 21 recorridos
originales al primer intento. La CI original conserva FAILED en UI3: cuatro
fallos del cierre8 completo; pasan selección y apertura, sin truncado global30.
La CI completa conserva FAILED: 521 expected, dos unexpected y un flaky entre
524 identidades, 527 intentos, cinco fallidos y tres retries. UI1 falla en su
primer intento de importación Android y pasa en su retry; el snapshot acredita
una aparición transitoria del cierre, pero no mide su final. Se conservan los
doce logs y once ZIP originales.
Los errores de método y las CI fallidas anteriores conservan su estado propio.
Detalle en [Rendimiento de 1.7.53](performance-1753.md).

## Cambios de rendimiento de 1.7.52

El libro activo conserva su fotograma nativo si sólo cambia una cinta que
realmente no existe, con guards de pose exacta, revisiones, owner y contexto.
Se conserva el resultado en 86 pares RGBA/PNG exactos: 44 → 30 dibujos por
perfil de calidad. La fuente final pasa 2.889 unitarias en 212 archivos,
build y 75 comprobaciones Python. Los siete recorridos locales originales
pasan al primer intento, incluidos los cierres nativos de 5.309,4 y 5.362 ms.
La web publicada pasa los tres recorridos de editor/regreso y los 18 PDF
originales al primer intento, además de HTTP, APK descargado y loader. La CI
original conserva FAILED en UI3: dos contratos nativos, cuatro fallos y dos
retries durante apertura. Ninguno llega a Back. El run completo termina
FAILED con 522/524 E2E expected y los otros diez jobs de prueba SUCCESS.
Se conserva el primer método GPU FAILED y
los fallos de CI anteriores, sin relajar assertions o plazos.
Ámbitos y límites en [Rendimiento de 1.7.52](performance-1752.md).

## Cambios de rendimiento de 1.7.51

El inicio del gesto comparte una captura nueva entre las vistas fine y overview
sólo si el frame, contexto, revisiones y dimensiones coinciden. Los exports
externos conservan su independencia. Pasan ocho pares RGBA/PNG exactos y la
batería local de 2.865 unitarias en 211 archivos, build y 75 pruebas Python.
Pasan los siete recorridos originales locales al primer intento: el gesto
mantiene veinte composiciones y cero nuevos renders de escena. Pasan también
los 21 recorridos de la web publicada, HTTP, APK descargado y loader. La CI
original completa conserva FAILED: 524 E2E, 522 expected y dos unexpected,
cero flaky u omisiones; cuatro timeouts y dos retries. Los dos contratos
nativos se interrumpen durante el cierre por el límite global de treinta
segundos, antes de consumir los ocho segundos de su espera de cierre.
Sus ámbitos se documentan
en [Rendimiento de 1.7.51](performance-1751.md).

## Cambios de rendimiento de 1.7.50

La devolución agrupa la pintura final y el layout pendiente antes de liberar
el libro. El tamaño y DPR del framebuffer nativo se asignan juntos cuando
cambian ambos; se conservan dimensiones finales, CSS y las rutas de respaldo.
La fuente final pasa 2.857 unitarias en 210 archivos, build y 75 comprobaciones
Python. La web publicada pasa 18 recorridos PDF y tres de editor/regreso nativo,
todos al primer intento; pasan HTTP, APK descargado y loader. La CI original
completa conserva FAILED: de 524 E2E, 522 expected y dos unexpected,
cero flaky u omisiones; cuatro timeouts y dos retries en la apertura nativa.
Sus doce logs y once ZIP se conservan como un ámbito distinto.
Controles, resultados y límites están en
[Rendimiento de 1.7.50](performance-1750.md). Los fallos originales anteriores
conservan su estado propio.

## Cambios de rendimiento de 1.7.49

La devolución reutiliza el modelo del lector al actualizar su portada HD y
su apariencia automática. La comparación admite sólo ruido numérico en la
clave de dimensiones; conserva los vértices reales, los acabados y el viewport.
El progreso actualiza el marcapáginas y las hojas antes del primer dibujo.
Back cancela la portada opcional pendiente e impide guardados o refrescos tardíos.
La fuente final, sus controles y la comprobación de publicación se registran
en [Rendimiento de 1.7.49](performance-1749.md). Sus resultados no sustituyen
los fallos originales de las versiones anteriores.

La CI original 1.7.49 (37224970834, fuente 1d47968) conserva **FAILED**:
2.843 unitarias en 208 archivos pasan; 524 casos E2E contienen 522 expected
y dos unexpected, cero flaky u omitidos. Sus 526 intentos incluyen cuatro
fallos y dos retries: los dos contratos nativos vuelven a incumplir el gate
original de ocho segundos. Se conservan doce logs y once ZIP autenticados;
los snapshots posteriores no prueban el instante real de fin de cierre.

La comparación de apariencia pasa 30 pares RGBA/PNG exactos contra el
modelo fresco. La web publicada pasa 18 recorridos PDF y tres de editor y
regreso nativo, además de HTTP, APK y loader. Son ámbitos distintos del CI
y no sustituyen su fallo ni acreditan fluidez en un teléfono físico.

## Cambios de rendimiento de 1.7.48

La página preparada deja de esperar a regenerar la portada PDF en HD. La
estantería de respaldo conserva el objetivo de un click mientras aplica los
refrescos pendientes. Se mantienen los cambios de memoria, modelos y gestos
de 1.7.47, con las mismas texturas y animaciones. La comprobación de la fuente
final y sus límites están en [Rendimiento de 1.7.48](performance-1748.md).

La CI original de 1.7.48 conserva **FAILED**: pasan 2.802 unitarias en 202
archivos; de 524 casos E2E, 522 son expected y dos unexpected, sin flaky.
Los dos contratos nativos incumplen el gate original de ocho segundos en sus
dos intentos. Se guardan 526 intentos, cuatro fallidos y dos reintentos, además
de los doce logs y once ZIP originales. La apertura sin WebGL pasa al primer
intento. La web pública pasa 21 casos sin reintentos y pasan HTTP, APK y loader;
estos controles no acreditan fluidez ni temperatura en un teléfono físico.

La CI original de 1.7.47 conserva FAILED: sus dos casos nuevos de devolución
alcanzan el límite global de treinta segundos y un caso original de selección
en el respaldo es flaky. Su reintento no transforma el resultado en aprobado.
Los logs y artefactos originales quedan preservados; la batería de la nueva
fuente tiene sus propios resultados.

## Cambios de rendimiento de 1.7.47

Guardar una edición reutiliza el modelo ya preparado del libro. Los avisos
consecutivos de cambios se agrupan y las lecturas de la biblioteca no se
solapan. Las texturas de habitación sin consumidores se liberan; los gestos
no restauran un buffer que van a ocultar inmediatamente. El canvas nativo
de inserción pertenece al host del libro hasta su entrega a la estantería.
Se mantienen texturas, DPR, geometría, materiales y relojes de animación.

Los resultados de esta fuente se incorporan a
[Rendimiento de 1.7.47](performance-1747.md) tras ejecutarse. La verificación
del teléfono físico y la sesión real de Google continúan pendientes; las
pruebas de escritorio no acreditan su fluidez ni temperatura. La APK 1.1.4
continúa cargando la publicación web con su loader.

## Cambios de rendimiento de 1.7.46

La selección y devolución mantienen el canvas WebGL y conservan las imágenes
resueltas en la GPU. La estantería y la inserción comparten su renderer; los
consumidores 2D materializan una captura sólo cuando la solicitan. Los modelos
pendientes idénticos se conservan y reciben el progreso reciente sin recrearse.
El DPR, las texturas, los materiales, la iluminación y los relojes permanecen.

La comprobación de imágenes, los contratos de devolución, los fallos originales
y el costo adicional de memoria tienen su alcance en
[Rendimiento de 1.7.46](performance-1746.md). El reloj pesado de SwiftShader sigue
superando ocho segundos: este cambio no acredita fluidez, batería ni temperatura
en un teléfono físico. La web publicada supera los 18 casos PDF, mientras
que la CI original conserva cinco fallos de navegador de 524 casos. Las
verificaciones completas anteriores conservan sus resultados propios.
La APK 1.1.4 continúa cargando la web publicada mediante su loader.

## Publicación verificada de 1.7.42: PDF adaptable

La vista adaptable muestra las fotografías con sus colores originales, incluidas las giradas, y conserva el texto antes y después para navegar, buscar, guardar posición y narrar. Los cambios de tamaño de letra con interlineado normal ya no crean párrafos nuevos. La página anterior permanece visible mientras se prepara la siguiente: la regresión reproduce un intervalo vacío en 1.7.41 y pasa con 1.7.42.

Fuente `7f5ebd9f78dddeb53d4419e75920014612487510`, Pages `6ad512f6e5353db3d980ffd20d0514bbee5785bb`. La [CI original 37196721440](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/37196721440) pasa **2.657 unitarias en 175 archivos y 522 E2E**, 3.179 en total, sin omisiones, reintentos, flaky ni errores. Sus doce jobs y once ZIP originales se contrastan con el censo de la fuente; certificado `4306c2be20aa339d50d9377ead9b292998cb952d60e22d3056831817aaa2afed`. Pasan también las 75 comprobaciones Python originales.

La web pública pasa **18 casos PDF** sin reintentos, con **310 cuerpos HTTP** contrastados y 15 capturas; se revisaron papel, AMOLED y escaneo. Los cinco temas mantienen los RGB originales de las fotos y los marcadores de texto son alcanzables antes de cambiar de página física. Los casos de narración usan un motor controlado explícito para comprobar posiciones; los motores naturales tienen sus pruebas separadas en la CI completa. Certificado público `185e2ecc16bf0791a9290f4a228cac4378f1c2f1c3645f6dde9496e897827680`.

Los 23 módulos y 44 recursos offline coinciden con Pages por HTTP. El entry real `main-BWBX5xkG.js` tiene 1.418.744 bytes y SHA `bba76d53106a4952890da4418fc79bd204b3bdbe6e8a3983c1858d3a84a104c7`; certificado del artefacto `2d69e94190d614bafa036271e2d5362100a6587f72dd7b5dce4c528a9877d427`. Certificado de entrega `29668ee90a24ebcc38acb036cce7d4621ed861abddd964e6ab5b7f509397100f`.

La APK descargada de nuevo sigue siendo **1.1.4, código 17**, 78.515.243 bytes y SHA `feafaaa762b35344ac8b19418f9f6eb6cb1f725fba22b1ef3d3f273bd32a6191`: idéntica al APK firmado anteriormente comprobado. El inventario público contiene únicamente su loader de 2.089 bytes y dos stubs vacíos; el loader coincide byte por byte con la fuente. No se atribuye una captura nativa nueva a esta corrección web ni se necesita reimportar los libros.

La implementación previa 1.7.41 tiene su comprobación independiente: fuente `cadd93869ce935ed229dc440df6d277b24563372`, [CI 37195770731](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/37195770731) con 2.656 unitarias y 522 E2E, 18 casos locales y otros 18 sobre esa publicación. Conserva los fallos de la fuente anterior y de las primeras fixtures/auditoría. La corrección de carga 1.7.42 tiene resultados propios y no reutiliza esos casos como prueba de la versión actual.

Las páginas sin texto se muestran como imágenes, sin OCR. Las composiciones que PDF.js no puede delimitar con seguridad conservan la página original junto al texto. El orden de cualquier PDF mal formado no queda garantizado. [Implementación y regresiones](pdf-adaptive-content-1741.md). Los pendientes históricos de Google, teléfono físico y configuración gráfica adicional permanecen en sus secciones anteriores.

## Publicación verificada de 1.7.40: cierre y profundidad

El retorno marca el hueco antes de reconstruir los nodos del mueble, prepara su proyección bajo la página opaca y entrega un único repintado antes del zoom. Los tres materiales originales de profundidad se enlazan con el primer batch de la estantería, sobre la geometría ya existente del indicador. No añaden objetos visibles ni render passes. Durante la inserción, el libro oculto no invalida la imagen ni las sombras de una habitación que no cambia; los cambios reales pendientes siguen respetándose. Su watchdog observa el reloj original de la inserción.

El framebuffer del libro y el depth pass de inserción usan ventanas de cámara alineadas a píxeles. El canvas final, DPR, materiales, iluminación, geometrías, sombras y relojes de animación permanecen. El primer zoom, un DPR fraccionario y cualquier modelo que no cabe usan el buffer completo. La profundidad continúa recortando el libro detrás de sus vecinos y madera.

El candidato aislado final completa **7.062,9 ms** en el reloj DOM original del móvil 390 × 844 a DPR 2, sin reintentos y con el mismo límite de ocho segundos. Pasan **20 casos originales** de apertura y temas, incluidos giro/cancelación, CBZ, PDF, EPUB, fallback y movimiento reducido. Cinco poses GPU, desde la página ampliada hasta el lomo girado, comparan 5.266.560 componentes RGBA por pose: **cero diferencias**, con portada brillante, lomo dorado, página, texto y marcapáginas. No es una medición de un teléfono físico. Los ensayos anteriores fallidos se conservan: no se publica el candidato que contenía texto mal codificado, aunque su reloj pasaba. La equivalencia de runtime con la fuente final está contrastada: sólo cambian el footer de versión y comentarios. Su CI y publicación tienen pruebas propias indicadas a continuación.

Fuente `4bfed7bca97e094c189c54c66de424ea09fa3dcd`, Pages `6ebd58117eb3c2ff88fdac0772c1fbe50a0dc8ce`. La [CI original 37170288785](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/37170288785) supera **2.639 unitarias en 173 archivos y 514 E2E**, 3.153 en total, sin omisiones, reintentos, flaky ni errores. Se contrastan sus doce jobs y once ZIP originales; certificado `5a16b70dabb6d3ab61f3ec670020a75afc11e791cf367486e6d6a9f446ba1df2`. Las 75 comprobaciones Python también pasan en esta fuente.

La comprobación HTTP coincide con los 23 módulos y 44 recursos offline. El entry real `main-r6wn8ozD.js` tiene 1.418.752 bytes y SHA `4f165f565dd55b3e099d407126fc18238eabde5ebb068400c1040fe88f0f1d43`; certificado HTTP `4000cc464259183180470ad49d379ae9c839ea31b093e31725849b4beffeaa62`. Los seis casos funcionales publicados pasan con 133 cuerpos HTTP y cuatro PNG revisadas: capítulos reales, ampliación offline de perfiles, carga del lector, catálogo móvil y estantería isométrica. Certificado `49a5eaf4cd63aec6f549ad861e0dc8ee399bc366954fd13cdbfed7e372814e84`.

Un séptimo caso público conserva el test original del cierre a DPR 2 y su presupuesto de ocho segundos. Con el launch por defecto de la prueba local original, registra **6.914,7 ms**, entrega real del libro y limpieza del overlay, sin reintentos. Los cuerpos de la app se contrastan con Pages. El contexto observado pertenece a **ANGLE / SwiftShader Vulkan 1.3.0**, un renderer de software; no acredita un teléfono físico. Certificado `f58e5c6dbc8eab835df49d4a35472dfd8fbb27deafcc8e9aebb7befa3f45e7a8`.

Se conserva separado el primer caso adicional que fuerza `--use-gl=angle`, `--use-angle=swiftshader` y `--enable-unsafe-swiftshader`: **9.274,7 ms, FAILED** con el mismo límite. No se transforma en aprobado ni se explica su causa por una diferencia de driver que no se haya observado. Los candidatos posteriores 55–67 no se publican: no acreditan la mejora buscada en esa configuración. El candidato 67 pasa el perfil original en 7.084,8 ms, sin una mejora demostrada frente al candidato publicado; también conserva el fallo de la configuración forzada. Sus mediciones y fuentes permanecen separadas.

El certificado de entrega `ee3a2249d3a4ece630feb46ccacc2a5898cd5ae1cc29180a1b805b699386dc7c` conserva tanto las aprobaciones del perfil original como ese fallo adicional y las verificaciones externas pendientes. La APK sigue siendo 1.1.4: los archivos del wrapper/loader y módulos seleccionados de audio, lectura y Drive son idénticos a la fuente nativa probada en 1.7.39. Esto es equivalencia de fuente, no una captura nueva de Android sobre 1.7.40.

## Publicación verificada de 1.7.39 y Android 1.1.4

Fuente de producto `8602135708e520c35ae52483fbfd5e19a2c54203`. La [CI original 37167629565](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/37167629565) pasa **2.628 unitarias en 171 archivos y 514 E2E**, sin omisiones, reintentos ni flaky. Sus doce jobs y once ZIP originales tienen un censo independiente; certificado `61d7cbda81e9b321e4c11e14aee4ab1aad9c8c57037b40651d4103daf7ed5f5a`. Los 20 casos locales originales de apertura/temas y las 75 verificaciones Python también pasan.

La primera publicación web pasa seis casos sobre sus archivos reales, con 132 cuerpos HTTP y cuatro capturas revisadas; certificado `2d73a806b7059923e5951033b39ea0b9fb8cf8ce3e0d0cc716f944f9d9ab53ad`. Tras publicar la APK, sólo cambia el manifiesto Android en `43f1c103f0f3c4f6db4541d2598145e2136064fe`, Pages `e60b10bb907ea3c17cfbfd0ed79994fa8c453238`. Una comprobación HTTP nueva contrasta los 23 módulos, 44 recursos offline y módulos antiguos conservados. El entry continúa idéntico: `main-ChTFJ3tE.js`, SHA `0674c21c0b3d9b95d2d666641298d66f50f7d940622990d0d8bf011072e2db92`; certificado `62b9c4f289a0f5822fd68a0dcb8f0a24a3de1df9dc35172229a1bd01f9ec9c82`.

El [build Android original 37167745832](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/37167745832) supera los nueve estados de pantalla y todos los gates originales de audio: **367.887 ms bloqueado**, capítulos 0–22, 136 starts/135 dones hasta el corte bloqueado, **30,822 segundos de PCM real en los últimos 30 segundos**, pausa/reanudación/Detener de la notificación y limpieza al cerrar pausado. El PDF avanza por sus páginas físicas 0 y 1, reproduce 50,565 segundos de PCM real bloqueado y Detener funciona después de despertar. Al parar se liberan servicio, audio pendiente y Wake Lock. No se usa recuperación al despertar, audio artificial ni voces del dispositivo. Certificado final de revisión `5039dbda12cec7f47ba6daf517ac9282d57eb3f6fbb09145a9a93bd70c756ffe`.

La captura fría muestra el PDF sin hora ni iconos del sistema. La PNG de Detener PDF es una captura intermedia beige y no se usa como prueba visual del botón: el XML original contiene «Detener», y la acción original, callbacks y volcados finales acreditan el Stop y cleanup. El primer auditor pasivo confundía los dos starts posteriores al corte bloqueado con su resumen; se conserva fallido y la revisión final contrasta callbacks y eventos hasta el mismo corte original, también para PDF. No se cambian tests, plazos ni resultados nativos.

La [APK pública 1.1.4, código 17](https://github.com/miguelcoxcaballero/inhouse-read/releases/tag/android-v1.1.4) se descargó de nuevo: **78.515.243 bytes**, SHA `feafaaa762b35344ac8b19418f9f6eb6cb1f725fba22b1ef3d3f273bd32a6191`, idéntica al build autenticado y al manifiesto servido. Firma V2 comprobada criptográficamente con el mismo certificado de 1.1.3. Mantiene el loader exacto de **2.089 bytes**, junto a dos stubs Capacitor vacíos; no incorpora una copia de la web, modelos ONNX ni WASM. Incluye las bibliotecas nativas ONNX de las cuatro arquitecturas. Certificado público `73b9a5b6cceece924748b443f9937e0421bced40d20a4223bb69800002b9d69a`.

Se conservan los verificadores públicos fallidos anteriores: uno imponía el antiguo límite arbitrario de 64 MB y otro contaba los dos stubs de cero bytes como una app empaquetada. La revisión final exige el tamaño exacto autenticado y el inventario exacto de tres archivos públicos. El nuevo tamaño corresponde al motor ONNX nativo; las voces siguen siendo descargas opcionales. La página real de descarga muestra 1.1.4 y 74,9 MiB.

Estos ensayos de emulador y navegador no acreditan calidad acústica, temperatura, batería, FPS ni reproducción indefinida en un teléfono físico. En esa fuente quedó pendiente el plazo del cierre; 1.7.40 tiene su comprobación separada arriba. La autenticación/subida real de Google continúa sin una sesión disponible.

## Cambios de 1.7.39

El bookView prepara modelo, snapshot y pose sin pintar hasta el encuadre final, incluyendo vistas reutilizadas. El setter conserva su contrato de un argumento y realiza una sola copia cuando corresponde. Pasan 2.621 unitarias de la candidata aislada y 20 casos originales de apertura/temas en el primer candidato. El ensayo DPR 2 de ese primer candidato conserva FAILED: 9.123 ms frente al límite original de ocho segundos. No se reducen resolución, materiales ni presupuestos de animación. La fuente final pasa 2.628 unitarias en 171 archivos, 20 casos originales de apertura y temas sin reintentos, build y 75 verificaciones Python.

El puente nuevo setReaderOwnership conserva la propiedad del libro al cambiar la visibilidad del WebView; el lifecycle de la Activity decide la política de pantalla. Las APK anteriores siguen usando setReadingMode. Se añaden cinco casos de bloqueo, cierre, disposal, BFCache y animaciones y dos contratos Java/Kotlin. Pasan 29 focales, incluidos los originales. La nueva captura Android 37167745832 está aprobada según la sección actual; los fallos históricos se conservan.

## Verificación de 1.7.38

Fuente `937f9e2dd665b9d6e65b56adaa83fc20d32585b8`, Pages `cbeff03c92c690d0fd948389792aa9663f00b5d1`. Coinciden 23 módulos y 44 recursos offline por HTTP; certificado `af4656e9eb6ade70e80a6e2b3472a0c5c337be212b59197c4330700211953c3a`. Seis casos públicos pasan sin omisiones ni reintentos, con 131 cuerpos HTTP y cuatro capturas revisadas; certificado `881e722cb06ecbf42f04509618b92f7f6bb01192359b212fbf95254437fe444c`. Pasan 2.617 unitarias en 169 archivos, dos E2E finales y las 75 comprobaciones Python originales. CI original `37165866474` pasa estrictamente: 2.617 unitarias en 169 archivos y 514 E2E sin omisiones ni reintentos; certificado `9b257196c4726a9d03b7313ec1017420051184b6c15598e7787f2e8fbf25c1c6`.

Android original `37166006039` conserva FAILED. Supera 367.387 ms bloqueado, capítulos 0–22, 138 starts/137 dones y 30,838 segundos PCM en los últimos 30 segundos. Pasan pausa, reanudación, Detener y cierre mientras está pausado mediante los controles reales. El PDF avanza bloqueado por las páginas físicas 0 y 1 con PCM real, pero falla el control Detener de la notificación después de despertar. La captura muestra el lector con la página 2, sin la notificación; no demuestra por sí sola la causa. El ZIP original autenticado contiene 12.408.960 bytes y 151 miembros; certificado de captura `ab851805acde12af8ddcc2d29e43e02078f85829338b06a009c7cac64ee3f924`. No se publicó APK ni se actualizó el manifiesto.

La CI original de 1.7.37 `37164356602` pasa estrictamente: 2.612 unitarias en 168 archivos y 514 E2E, sin omisiones ni reintentos. Certificado `6e3946f23764301ade4adc381ba625afc647b68c90d53f7dbc1b90590d6a4f9d`.

## Candidata 1.7.38: controles multimedia Android

La sesión recibe metadata del libro y estado antes de startForeground, identifica la ruta local y permite abrir la Activity real. La acción Detener también se publica como custom action de PlaybackState, porque los controles modernos se derivan de la sesión. Java y Kotlin sólo cambian la visibilidad de las barras cuando cambia el modo de lectura/lifecycle; los callbacks de foco mantienen su política sin repetir hide sobre el panel del sistema. Estas correcciones requieren una captura nativa nueva con los mismos gates y plazos.

## Verificación de 1.7.37

Fuente `b45a891d8acd6b69afebe7e8b6b00fc80e3edb3b`, Pages `25b2c651445eb1054b315c446e9d9dd3093489c8`. Coinciden por HTTP 23 módulos y 44 recursos offline; certificado `925954ddb5666674ec71d318b6cc99b0a6209be472dddefce594faa09ffa1475`. Seis casos públicos pasan sin omisiones ni reintentos, con 131 cuerpos HTTP y cuatro capturas revisadas; certificado `c69621c7eba4acde91ae7817f13ec9c9748242eb52d58496fa9ad1f1f0fe0baa`. Pasan 2.612 unitarias en 168 archivos, 21 E2E locales finales y las 75 comprobaciones Python originales. La auditoría completa de CI `37164356602` permanece separada.

Android original `37164475709` conserva FAILED, ahora por el control Pausar de la notificación tras despertar. Sí supera el gate original de continuidad: 367.915 ms bloqueado, capítulos 0–22, 135 starts/134 dones y 30,726 segundos de PCM en los últimos 30 segundos. No usa recuperación después de despertar. El ZIP original autenticado contiene 8.528.126 bytes y 109 miembros, SHA `91395bcb548f68a6688bd4aac23de6947323f85b343a6758dba06269bfb4b2dd`; certificado de captura `9543a3e8b0e55eb4143c19788ab2a1c7c19e0a4ade86fa53d234346ba19826db`. No hay release ni manifiesto nuevos. Los gates posteriores de detener, cleanup y PDF no se alcanzan.

El perfil local del cierre a DPR 2 termina en 10.023 ms y falla el plazo original de ocho segundos. La creación del modelo ocupa unos 18 ms; predominan las esperas al copiar el framebuffer GPU. La candidata aislada de framebuffer recortado también falla ese plazo y no se publica como corrección. Las primeras copias aisladas omitían plugins Vite de producción: su error CBZ no se atribuye al lector publicado. Los ensayos posteriores conservan el build fiel y sus fallos.

Google permanece sin sesión autenticada disponible: el preflight público no demuestra permisos, token, subida ni sincronización real.

## Candidata 1.7.37: inferencia nativa de voces

La nueva APK usa ONNX Runtime Android 1.22.0, un único executor y un hilo CPU por sesión. Conserva los archivos descargados, feeds, estilos, velocidad, fonemización y procesamiento PCM. Piper, Nakdimon y Supertonic comparten este puente. Los argumentos del modelo se transfieren por partes limitadas y los resultados corresponden a inferencias reales; no hay heartbeat, audio falso, recuperación por despertar ni voces del dispositivo. Los libros y sus posiciones continúan pasando por el lector original. La web y las APK anteriores conservan el worker.

Pasan 25 focales y una batería de 2.612 unitarias en 168 archivos. La revisión encontró una carrera nueva al volver a la voz anterior mientras se preparaba otra: el caso original reproduce el retorno prematuro, y se serializa detrás de la preparación pendiente. Se conserva su fallo, además del primer fallo de contrato por una palabra en el comentario Java. Los casos reales de escritorio generan PCM con las tres voces Piper a 1×/1,25× y 22 idiomas Supertonic × F1/F2/M1. La UI/origen de Android son stand-ins en este ensayo; no acredita audio con pantalla bloqueada ni velocidad en un móvil. El Java instalado tenía una DLL MSVC incompatible; los errores quedan conservados. Se utiliza un JRE Temurin aislado, cuyo ZIP coincide con el checksum oficial, sin modificar Java del equipo. La fuente final, CI, HTTP y captura nativa siguen separados.

## Verificación de 1.7.36

Fuente `3a6c508517c9e4359c091af5bd33edd8d97f6b9c`, Pages `7bbf8f5722cc2db6feb0de06ed79582416977425`. Sus 22 módulos y 43 recursos offline coinciden por HTTP; artefacto `01f92d0cef89e007dbb6c23f3c73cf7ddce374b1024b78f6861e0e82047ca09a`. Seis casos públicos pasan sin omisiones ni reintentos, con 125 cuerpos HTTP y cuatro capturas revisadas; certificado `a3d7e659cff08e9d263a47f419343d3e0e1c8a60da2e3f72f6a1b1cf3f43d1cb`. Pasan 2.596 unitarias locales, 21 E2E y 75 comprobaciones Python.

La CI original `37162089451` conserva FAILED: 2.596 unitarias y las 514 identidades E2E, pero el primer intento de la prueba de planta junto a libro fino no termina el cierre dentro de sus ocho segundos. El reintento pasa; no se utiliza para aprobar. La captura original conserva la fase closing, apertura de portada 0,2267 y un view nuevo; no determina por sí sola el coste interno. Once ZIP y doce jobs se conservan autenticados, certificado `b72559a97e5990f5e1306c7bac7db83c08bda74905ad84a21eece3cb17744cd0`. El cierre queda por corregir sin ampliar el plazo original.

Android `37162208867` conserva FAILED: 120 starts/dones, 240 callbacks emparejados y ningún PCM nuevo durante los 30 segundos finales. El ZIP tiene 8.831.654 bytes, SHA `484572b6067021f1a8967a85e10625e3ac461b55d6da0306e024188b15678898`; captura `69f4824e0a8dfd0dc3ed1e092d89e842a1a34c84dc922ad8ffdc2f19fe7f3cab`, fallo preservado `6ee5fe912f925bedc86a7a804f84de47f8fa7c50e6e409d4c381e27b0362805f`. Los 21 finales que vacían la cola tienen sus 42 observaciones posteriores. La última muestra el fragmento 121 en synth y cuatro entradas listas; no llega un nuevo recibo del worker antes de despertar. El lector está idle, sin navegación pendiente. Esto localiza la petición no procesada, sin demostrar la causa concreta del scheduler. No se publica APK; la recuperación después de despertar sigue siendo sólo diagnóstico.

## Cambios preparados de 1.7.36

La extracción EPUB conserva el Inflate original de zip.js, bytes locales, documentos, encodings y CRC; se desactiva sólo su dependencia de DecompressionStream nativo. La regresión nueva reproduce cinco entradas al codec nativo en la fuente anterior y pasa con cero sobre el candidato. Pasan 10 focales, incluidos los siete originales de bytes/ZIP. El primer E2E nuevo tenía un censo incorrecto de tres capítulos para un fixture de dos; se conserva fallido. Con el censo exacto de dos capítulos, el build anterior conserva otro fallo: seis llamadas al codec nativo. No demuestra todavía la causa de la interrupción Android. Cada done real que deja la cola vacía conserva un snapshot en su evaluación original; se elimina el filtro diagnóstico que sólo observaba el primero del epoch. No hay polling, timers ni evaluaciones añadidas al puente.

Sobre el build final pasan **2.596 unitarias en 165 archivos**, **21 E2E sin omisiones ni reintentos** y las **75 verificaciones Python originales**. La tanda E2E incluye 14 casos con modelos naturales reales, tres de continuidad/pausa/detener entre capítulos, dos de lector/catálogo, espeak offline y la regresión de descompresión. La publicación, CI y captura Android nuevas siguen separadas.

## Verificación de 1.7.35

Fuente `9a15ab839d19597e13a2bb88f8fe138f91482a8a`, Pages `73ba3a8071e17863b8515f555057a514d9ce9fb2`. Pasan 2.594 unitarias en 164 archivos, certificado `2ccb45506f6594ebf92515b8bb3d2a14fb6128f8318f53d7c23047d6794ae44d`. Coinciden por HTTP 22 módulos y 43 recursos offline, artefacto `8ad481fc8b06bb3accd7ad603e3995c8a4009eacb1174f6b3a634bd0d253e429`. Cinco casos públicos pasan sin reintentos, con 110 cuerpos HTTP y cuatro capturas revisadas; certificado `67b4767e0a57a6377c8cc3877c47818579262d6e446d20e5be956d105314f84f`. Pasan 17 E2E locales finales y, por separado, tres casos originales de continuidad/pausa/detener entre capítulos. CI original `37160432704` aprobada: 2.594 unitarias en 164 archivos y 513 E2E sin omisiones ni reintentos; certificado `e7f93a074b8c96255728c6bd04deae5c1efd55189ed679c0c916b12f83653384`.

Android `37160573040` conserva FAILED: 366.366 ms bloqueado, 120 starts/dones, 240 callbacks emparejados y cero PCM nuevo en los 30 segundos finales. Captura `77b45ca1e5b9c83c5aebdc470fa9a77e9dfb5c8590eb9e4852e5b663b1169ef6`; ZIP 9.349.798 bytes y 104 miembros. Los 175 recibos originales de síntesis muestran que la petición 27 completa su fase 7; no hay una petición posterior antes de despertar. Revisión de fases `092dd1964324730b97be987717050343ec384366254074462ee84c8cb7b4dbc7`; fallo preservado `306e576a63d3c598ae89c3b5c7c16a87512aa3176122c391068b8904707480f9`. No se publicó APK. La extracción del siguiente capítulo sigue siendo una hipótesis por comprobar; la recuperación al despertar no aprueba el gate.

## Cambios de 1.7.35 en preparación

El fonemizador carga una vez su código WASM y el paquete de datos, compila una vez y crea una instancia y un sistema de archivos nuevos cada 40 llamadas. Los datos maestros se conservan inmutables; cada filesystem recibe su propia copia. Pasan 51 focales en siete archivos y un caso con espeak WASM real: 161 llamadas, cinco heaps y tres idiomas con IDs constantes. Tras las primeras 40 llamadas se desconecta la red y no hay refetch de WASM ni datos. El primer ensayo focal conserva 28 aprobados y un fallo del nuevo doble de respuesta vacía: reutilizaba un mismo Response en dos lecturas; se corrige ese doble para entregar cuerpos distintos.

Los recibos nativos sólo registran fases numéricas en los awaits originales del worker, cuando el puente diagnóstico está presente. No incorporan texto, timers, polling, evaluaciones adicionales ni cambios de reproducción. La descarga repetida es una dependencia eliminada; el registro anterior no prueba que sea la causa del fallo Android. Pasan **2.594 unitarias en 164 archivos**, build final y **75 verificaciones Python**. El caso real del fonemizador y las 51 focales conservan resultados propios; las pruebas finales con modelos reales, CI, publicación y captura Android siguen separadas.

## Verificación de 1.7.34

Fuente `3850274e7bfbe639dd1718bd1a8ecffecd742427`, Pages `5430b1f64794b502da8c424883bfd91a3a4311a5`. Pasan 2.584 unitarias en 162 archivos, certificado `dfc1d9de0805f58af78fe6f14827d4c516f4c8c6db3ce1c7e9c73492a98f06f1`. Coinciden por HTTP sus 22 módulos y 43 recursos offline; artefacto `069cc291f4787efc0e591556fab06e51af657968b86c8bd25c8e1d65b0fc6895`. Cinco casos públicos pasan sin omisiones ni reintentos, con 109 cuerpos HTTP y cuatro capturas revisadas; certificado `8d461555b44ae3dcb30f0c16d8171000a985907740cd9523dbf718df61160c39`. El primer pin rechazó HTML anterior durante la propagación y conserva sus bytes. CI original `37158691462` aprobada: 2.584 unitarias en 162 archivos y 512 E2E, sin omisiones ni reintentos; certificado `7dd6e83519e7b2e2072cd765f15caafca15449afa245615cddf30143cde6c8e2`.

Android `37158815932` conserva FAILED: 368.473 ms bloqueado, 120 starts/dones y 240 callbacks emparejados, capítulos 0–19, cero PCM nuevo en el tramo final de 30 segundos. El ZIP original autenticado tiene 8.512.616 bytes y 112 miembros; certificado de captura `3fd731a1a5175e2d6af7e44991a20ff19c413654340e578cb4284a36c1bbf288`. No se publicó APK. Los 120 fragmentos reproducidos no son un recuento de llamadas al fonemizador, porque el audio puede reutilizarse del caché. La recuperación al despertar permanece sólo diagnóstico.

## Cambios de 1.7.34 en preparación

Con la pantalla apagada, Foliate obtiene el texto del capítulo siguiente mediante su extractor original de documentos, sin navegar el iframe ni esperar su renderizado. Sólo el inicio audible activa ese capítulo; la posición se guarda con el CFI real del fragmento. Al volver a la app se muestra la posición más reciente y se conserva el paginador normal en primer plano. No se añade audio silencioso, heartbeat, recuperación por despertar ni sustitución de voces.

Pasan 91 focales en siete archivos, incluidos 12 de documentos/CFI y tres de ReadingVoice con capítulos completos. El primer candidato conserva 51 aprobados y tres fallos: dos regresiones de orden de navegación corregidas dentro de la cola original y un helper de CFI de test corregido para utilizar el contrato real. Los ensayos iniciales permanecen separados. Las dos primeras baterías completas conservan cada una 2.583 aprobados y un fallo de snapshot: la espera vacía de catch-up retrasaba su inicio. Se corrige esperando sólo cuando existe un cursor audible; pasan 35 focales de snapshot, cursor y navegación. Los tests originales no cambian. Build final y cinco E2E finales aprobados sin reintentos: continuidad entre capítulos, pausa/detener durante el cambio, carga del lector y catálogo móvil. El candidato anterior pasó 17 E2E, incluidos 14 con modelos reales; el primer lanzamiento con una variable de fixtures incorrecta conserva tres aprobados, cuatro fallos de preflight y diez omitidos. No se suman ni se convierte ese intento en aprobado. La batería completa final, publicación y captura Android nuevas están pendientes.

## Verificación de 1.7.33

Fuente `a02d85ec0ada05daabc8293ae2cdcf2887fa826f`, Pages `257868c27be0f07a52b4732ee0fd24b0468e0e25`. Sus 22 módulos y 43 recursos offline coinciden por HTTP; certificado SHA-256 `937942ec1c8366e5a8714d1556cfa06c8edd16861f7cd32117b20751d93938fa`. Cinco casos públicos pasan sin omisiones ni reintentos, con 110 cuerpos HTTP y cuatro capturas revisadas; certificado `f1373b793360de039bb8d362b9b4a0b3327807ed664753b344637d9913d08d13`. CI original aprobada, run `37156691213`: **2.569 unitarias en 160 archivos y 512 E2E**, sin omisiones, reintentos ni flaky. Certificado SHA-256 `41ae3ea781910ec55b51cf8267830a5b502b6f6fe42984c8842a5a4d40afabfd`.

Android `37156804640` conserva FAILED: 108 starts/dones y 216 callbacks emparejados; cero PCM nuevo en el tramo final de 30 segundos. El último cambio llega a `viewLoadPending:true` y no termina antes del gate. El ZIP original autenticado tiene 9.412.228 bytes; certificado de captura SHA-256 `ccc1a3b3e0d17317d6fdd63987603d8e1ca20e69c75d369df73a9a44ded194c8`. La recuperación al despertar sigue siendo sólo diagnóstico; no se publicó APK. La primera recogida HTTP falló por timeout mientras el run seguía activo; se conserva separada de la segunda recogida del mismo run, sin repetir pruebas.

El botón Google real de la web publicada abre la página oficial para introducir la cuenta. La petición pública Android, con su cliente y redirect de producción, también obtiene la página de acceso sin `redirect_uri_mismatch`. Son preflight sin cuenta, permisos, token ni subida real: no acreditan una conexión Drive completada.

## Cambios de 1.7.33

La preparación cuenta sólo el prefijo de audio anterior a la frase que falta. Una frase posterior guardada, incluso de una página diferida, no retrasa la frase actual. Los recibos reales start/done también liberan PCM que esperaba espacio en AudioTrack; la apertura de la cola ignora las frases terminadas cuyos buffers ya se liberaron. No cambia la voz, muestras, velocidad ni límites de preparación.

La fuente 1.7.32 reproduce cinco fallos y un aprobado en seis casos sin avanzar temporizadores. La corrección pasa los seis, los 37 existentes de motor y los 16 de salida nativa: **59/59**. Batería completa: **2.569/2.569 en 160 archivos**, build aprobado. Pasan **14/14 E2E con modelos reales**, sin reintentos ni omisiones, incluidos Argentina, EPUB/PDF, continuidad entre páginas, cambio de voz, reinicio tras 90 segundos y modo sin conexión. Android necesita captura nueva. Un primer intento E2E no recibió la ruta de modelos del equipo: dos preflight fallidos y diez omitidos, conservados en `release-1733/reading-e2e.log` y sus trazas. El ensayo con los modelos locales tiene resultados propios y no convierte ese intento en aprobado.

## Verificación de 1.7.32

Fuente `80cef03d0848ad9ac864634f2d6bd3cfa544a3a5`, Pages `f5470f8dfdd6386fff5950688533aa38884cf7ae`. Sus 22 módulos y 43 recursos offline coinciden por HTTP; artefacto SHA-256 `4207654df4b9575f1039909244916e735a4b641bf1e1a9c007f134e5cf5a08db`. Cinco casos públicos pasan sin reintentos, con 110 cuerpos HTTP y cuatro capturas revisadas; certificado `ca0924e7161f84de3604c4afe737134396181f4b886acac008293ca64e4d4145`. Certificado de 2.563 unitarias locales: `f149d259662100c3764ebb3ca0efdb4ac4921086bf9f35293b196b472bc1b385`. CI original de esta fuente aprobada, run `37156109766`: 2.563 unitarias en 159 archivos y 512 E2E, sin omisiones, reintentos ni flaky. Certificado SHA-256 `1bcbec9db3667ebab3e16561a78196093f8dc7eac37d4ae8abd3fb0364c68d03`. La autenticación Google real mantiene su verificación separada.

## Cambios de 1.7.32

Las lecturas JSON y Blob de Drive comprueban la generación antes y después de consumir su cuerpo, sin una copia adicional del archivo. Los pasos de carpeta, listado, descarga, subida multipart/reanudable y progreso conservan la generación de su operación. Las carpetas sólo se invalidan si la petición que falla sigue siendo la que está guardada; cancelar la sesión descarta esos caches.

La fuente anterior reproduce **cinco fallos y tres aprobados** en ocho regresiones. El candidato preparado pasa **31/31**: las ocho nuevas, seis carreras de sesión y 17 contratos de OAuth/cliente existentes. Originales separados en `release-1732/drive-body-expanded-baseline.*` y `drive-body-expanded-candidate.*`. Son respuestas controladas, sin una cuenta Google real. Sobre la fuente final pasan **61/61 focales**, **2.563/2.563 unitarias en 159 archivos**, build y **cinco E2E sin reintentos**. Publicación HTTP y CI se verifican por separado.

## Verificación CI de 1.7.31

Run `37154550395`: **2.555 unitarias en 158 archivos y 512 E2E**, 3.067 en total, sin omisiones, flaky ni reintentos. Doce jobs y once ZIP originales autenticados, certificado SHA-256 `d91a51eaa82f5da3cabe274c97910d44beb5160a68994fa4ee16af528b3064b0`. Se conservan los mismos controles y censos; sólo se cambia el transporte HTTP de consulta a PowerShell ante el bloqueo de las peticiones CLI. La preparación inicial fuera del directorio del método falló antes de acceder a GitHub y se conserva separada.

## Verificación de 1.7.31

Fuente `0036d69eddd6549aa7750580e766fe1184405fc9`, Pages `9536329e84014f07f3cc30fba32acfdb6f9d04e0`. Pasan 2.555 unitarias en 158 archivos y seis E2E focales sin reintentos. Certificado local SHA-256 `fe58e9abbc6129abbaae99cfe105f0d1ac879e6407e27034de463bd8558e173e`. Los 22 módulos y 43 recursos offline coinciden por HTTP, artefacto SHA-256 `dbc90a5d0f6abc419a04c94520f15a1dff1210cc701114524db2c393e807a3d3`. Pasan cinco casos públicos con 110 cuerpos HTTP y cuatro capturas revisadas, certificado `900f8ad89bbe5f3e546f7deaa13335dd7058e727620c4adeacde42b0e4329d78`. La primera consulta de pin conservó HTML anterior durante propagación; sus bytes y el rechazo permanecen separados del segundo pin correcto.

## Cambios de 1.7.31

Batería local completa: **2.555/2.555 unitarias en 158 archivos**, un worker, sin omisiones; originales `release-1731/full-unit.json` y `full-unit.log`. Las comprobaciones CI, HTTP y Android de esta fuente siguen separadas.

Se conserva el View y su iframe entre capítulos, manteniendo la navegación real, el parser, el sandbox y la maquetación originales. Se eliminan los overlays y la observación del documento anterior. Los eventos `about:blank` o tardíos no completan la carga del capítulo nuevo; las fuentes anteriores tampoco expanden el documento actual. Los errores rechazan la promesa y cancelan sus listeners. El bloqueo del paginador se libera también cuando la carga falla o se cancela.

Pasan **29/29 focales en cuatro archivos**, build, **seis E2E sin reintentos** y **75 verificaciones Python**. Los E2E conservan los plazos originales: seguimiento y cambio de capítulo, cancelación al pausar/detener, cierre EPUB al girar, reapertura CBZ y conservación de ancla. La batería unitaria completa ha pasado. No demuestra aún continuidad bloqueada. El diagnóstico Android conserva un logcat completo antes de despertar o recuperar tras un fallo; los umbrales de audio y controles originales siguen intactos.

## Verificación de 1.7.30

Batería CI completa aprobada, run `37153385656`: **2.546 unitarias en 157 archivos y 512 E2E**, 3.058 en total, sin omisiones, reintentos ni flaky. Once ZIP y doce jobs originales contrastados; certificado SHA-256 `e137add78e5e68d3086268484b4e324cc805890bf53bb61418e33d835c105c8e`.

Fuente `be2cc4d7cfb11cd94959b7bae8902e4dea5d321d`, Pages `d9b530ba1adbce5b11d44cefa1b048e9ec33e0b3`. Sus 22 módulos y 43 recursos offline coinciden por HTTP; certificado de artefacto SHA-256 `90ff91df4cdbb52944bb2f45a4ce9d293a8f280c834c68eb947bc807d4d54bfc`. Pasan **cinco casos públicos sin reintentos**, con 110 cuerpos HTTP y cuatro capturas revisadas, certificado SHA-256 `37be533b1fcdbabae904ed8ebaf8d49ea25821ebdcdeb32f57248851cfb1bf23`. La batería CI de esta fuente sigue separada.

## Cambios de 1.7.30

Las peticiones de Drive conservan la generación de sesión y el token concreto con que empezaron. Se rechaza una respuesta de una cuenta que ya se cerró antes de continuar con otra operación; un 401 tardío de un token anterior no borra un token renovado. No cambia los clientes, permisos ni el flujo OAuth de Notes. La fuente anterior reproduce cuatro fallos en seis regresiones. Pasan las seis sobre la fuente corregida, las 17 pruebas existentes de cliente y las 30 de CloudSync: **53/53**. Build y cinco E2E aprobados sin reintentos: importar local/subir desde portada, conexión con foto, reintento, perfil y caducidad. Usan respuestas controladas. La comprobación con una cuenta real sigue pendiente por la falta de conexión del navegador autenticado.

## Verificación de 1.7.29

Batería CI completa aprobada, run `37151860869`: **2.540 unitarias en 156 archivos y 512 E2E**, 3.052 en total, sin reintentos, flaky ni omisiones. Once ZIP y doce jobs originales contrastados con su fuente; certificado SHA-256 `7060cf9d7a2004d6fefc94ffc78e12473095de10416061818f614fce61758703`.

Fuente `b4da77674116bd6e3598e3fc699143c9d53b5d6d`, Pages `f4f873374d55a40ea97c08d3e45733e83d927fe1`: **2.540/2.540 unitarias, 156 archivos**, seis E2E focales y cinco casos públicos sin reintentos. Certificado local SHA-256 `d854132c12c50218650915a1ecd96662b4f6ca2887ab1f939a0850305867d51c`; público `d46d10c2cc62c124f7153e60f693895ba3ccdc21cbeebb666d22380c7b52501a`, con 109 cuerpos HTTP y cuatro capturas revisadas. Los 22 módulos y 43 recursos offline coinciden por HTTP; artefacto SHA-256 `542132d212a89a7c30cad6b7d1a462ff0219a61f528278793176010650ddf623`. La preparación original alcanzó su buffer de 100 MB por los módulos históricos retenidos; el segundo método lee cada blob Git por separado y conserva todos los hashes. No altera pruebas ni límites del producto.

Android `37152067644` conserva **FAILED**: 114 starts/dones y 228 callbacks emparejados, pero ningún PCM nuevo en el último tramo de 30 segundos. Reutilizar eventos por mensajes y mantener el iframe en layout no basta para resolver la interrupción. La APK no se publicó. El ZIP original autenticado tiene 7.048.365 bytes y 111 miembros; certificado de captura SHA-256 `466a8f634b40b7777b90c20331c25a261e0613f6b2e0e3457b4ac811cc8e64a1`.

## Cambios de 1.7.29

El iframe del capítulo permanece en la maquetación con opacidad cero hasta recibir el evento original de carga y completar su renderizado. Se conserva la navegación, sandbox, cálculo vertical/RTL, fondo, estilos y observación de tamaño; no se añade un camino alternativo de preparación ni timers. Pasan 20 focales en tres archivos, el build y seis E2E sin reintentos: seguimiento al capítulo siguiente, pausa/detener durante el cambio, vuelta móvil EPUB, reapertura CBZ con resize y conservación de ancla. La continuidad bloqueada necesita un ensayo nuevo; esta hipótesis no convierte el fallo anterior en aprobado.

## Verificación de 1.7.28

Batería CI completa aprobada, run `37151378889`: **2.536 unitarias en 155 archivos y 512 E2E**, 3.048 en total, sin reintentos, flaky ni omisiones. Certificado original agregado SHA-256 `4922151ecf6e13d140c0e7aec93a63b562ca0355d029fe008c2796fb86d76cd2`.

Fuente `8a72d43cd021efe361a510e87f5a8cc8a98b04ef`, Pages `3a6c2e8a1489b49c002b2572ec097070bc74b503`. Pasan **2.536/2.536 unitarias en 155 archivos**, sin omisiones. Certificado local SHA-256 `3483647c880ff05e269a5884037e1a41f2c5e5790a6856c92368cc66faa19780`. Sus 22 módulos y 43 recursos offline coinciden por HTTP, certificado `artifact-1728-8a72d43.json`, SHA-256 `38d37f4ca385f7977e299a885c5fea00b47b13430ea286cca0703df18c5200fb`. Pasan **cinco casos públicos**, sin reintentos, y se revisan sus cuatro capturas originales. La batería CI completa de esta fuente ha pasado con certificado propio indicado arriba.

## Cambios de 1.7.28

Se rechazan las posiciones incompletas al guardar progreso: un evento de maquetación sin CFI/página válida no sobrescribe el marcador; tampoco una captura de cierre sin ancla. La regresión nueva usa Foliate e IndexedDB reales con un CBZ: en el build anterior, un evento sin CFI borra `epubcfi(/6/6)` y deja `null`. Se conserva ese fallo en `release-1728/position-public27-baseline.*`. Pasan 45 focales en tres archivos, incluidas diez sobre posiciones y su integración. Build y tres E2E posteriores aprobados sin reintentos: CBZ con resize, conservación del ancla y cámara isométrica. Batería completa y publicación nuevas pendientes. La prueba isométrica conserva el gate de ocho segundos y compara órdenes poblados después de importar, sin cambiar los requisitos de cámara, filas ni organización.

El ensayo Android `37150241529` conserva **FAILED**: 114 starts/dones, 228 callbacks emparejados y capítulos 0–18; no hubo PCM nuevo en los últimos 30 segundos. El penúltimo cambio de capítulo termina completo; el último llega hasta `displayStage:3`, `sectionLoadPending:false`, `viewLoadPending:true`, sin recibir la terminación de la carga del iframe antes del gate. Las fases anteriores y la recuperación al despertar quedan separadas. El cambio de tareas del worker no basta; no se publicó APK. ZIP original 10.004.779 bytes, 115 miembros; certificado de captura SHA-256 `31969171dbdbb028d9e06a9de247224fdcc5899b01f3c28516855842404ca267`.

## Verificación nueva de 1.7.27

Fuente `ecc6d526cd7b91471aef5bb72a6c0abc9efc5422`, Pages `70b9cd7baddb53f730e72021314c82ecac448a9b`: sus 22 módulos y 43 recursos offline coinciden por HTTP. La primera consulta conservó HTML de 1.7.26 durante propagación; la segunda obtuvo los bytes nuevos, con certificado `artifact-1727-ecc6d52.json`, SHA-256 `efdc662b02184fb437b193988660f00008415c6becd72c02011b28d7b807723d`.

La batería local original conserva 2.525 aprobados y un fallo: el VM de la prueba de hebreo quitaba imports y no inyectaba el nuevo helper. Con sólo esa inyección corregida pasan **2.526/2.526 en 154 archivos**; el certificado conserva el diff exacto y su alcance, SHA-256 `68f79dbb395b4bd30ebdc10c70a4e288afb801623e39f281117bd36e9947f310`. No se declara aprobada la fuente de tests sin modificar.

La primera tanda pública conserva **4/5 aprobados**: voz EPUB real, ampliación offline de perfiles, carga del lector y catálogo móvil. El caso isométrico comparó el orden vacío durante la preparación de geometría con el orden ya poblado; queda fallido, sin reintentos. El ensayo Android `37150241529` usa la web 1.7.27 y conserva el fallo de continuidad. Su certificado independiente de fallo tiene SHA-256 `858c3c3c05523ae6fe70a31952d32d09d824107e3ab6bb2647cc51a737aa2c5f`.

La batería CI de 1.7.26, run `37148530807`, conserva **FAILED**: 2.520 unitarias aprobadas, 511 identidades E2E, un caso PDF fallido y otro CBZ flaky. Once ZIP y doce logs originales autenticados; certificado SHA-256 `28a65465d80d9162f88422bb017cec9aca75bb882c17ca100a3cdbe56a39934f`. Los dos casos originales pasan en una tanda local sin modificaciones ni reintentos sobre el build 1.7.27; esto no convierte el run anterior en aprobado. Sus capturas originales se revisaron: muestran la página correcta en el modelo 3D mientras la transición sigue en curso.

## Cambios de 1.7.27

El worker neural, los pasos de inferencia Supertonic y el análisis de cortes de página ceden mediante una tarea MessageChannel finita, sin timers ni heartbeat. La cola de síntesis expone una promesa de terminación: liberar o cambiar de voz espera esa promesa en vez de consultar cada cinco milisegundos. Se mantienen modelos, pasos de inferencia, audio y cancelación. Pasan 39 focales en cinco archivos. Dos casos ejecutan el protocolo del worker real con timers suspendidos; el worker de la fuente anterior reproduce el atasco en el caso FIFO. El fallo original y sus fuentes quedan en `release-1727/timer-baseline-protocol.*`; no se presenta como una tanda aprobada. Build aprobado y cuatro E2E locales aprobados sin reintentos: navegación EPUB, cancelación al pausar/detener y gesto de portada. Batería completa, publicación HTTP y ensayo Android nuevos están pendientes.

## Cambios de 1.7.26 y estado actual

La fuente `918fae7cba9e0e2ad7fc846bb6f8b3a649966d93` está publicada en Pages `eebba5d390f39919f82ea6ab92e6402c31c299d9`. HTTP confirma sus 22 módulos actuales y 43 recursos offline. Pasan **2.520/2.520 unitarias en 153 archivos** y **5/5 casos sobre la web publicada**, sin omisiones ni reintentos, con 110 cuerpos HTTP autenticados. Certificados locales `release-1726/local-unit-certification.json`, SHA-256 `8b20a3c7a5e8f996f8bb325098a3d3f980c5d318df2007e3d3754706799037cb`, y `release-1726/public-918fae7/certification.json`, SHA-256 `6bee430a1e8a5c493440e93aaffed3fb6ed4585c74fa9c44daa0e0085d3736a9`. Las cuatro capturas públicas se revisaron. El primer intento de sellado faltaba el extractor de trazas; se conserva separado del segundo sellado completo, sin repetir las pruebas ni cambiar sus resultados.

El ensayo Android `37148623226` usa esa fuente y conserva **FAILED**: 108 starts/dones y 216 callbacks emparejados, pero ningún PCM nuevo en los últimos 30 segundos. El registro directo demuestra que el último cambio de capítulo termina en 23 ms (fases de sección, página y paginador completas). Después se reinicia la época de audio a 21 sin recibir PCM hasta despertar. Esto descarta que ese cambio de capítulo siga esperando una sección; no demuestra todavía qué espera del worker queda suspendida. La recuperación al despertar es sólo diagnóstico. No se publicó una APK fallida.

La batería CI de 1.7.25, run `37146772366`, conserva **FAILED**: sus 2.511 unitarias pasan y aparecen las 511 identidades E2E, pero el gesto de portada tiene un intento fallido y otro aprobado, por lo que se rechaza como flaky. Sus once ZIP y doce logs originales se contrastaron; certificado `release-1725/ci-failed-original-37146772366/certification.json`, SHA-256 `7a5c8366ce9c300e0f8858f3c59222e100418bc808282bd2525e9043bea2f92e`. El input llegó con sólo 0,586° de inclinación, frente al mínimo exigido de 3°.

Se prepara una observación del gesto después de pintar la pose, con input CDP real y el mismo gate sobre el ángulo efectivamente recibido. Tres repeticiones aisladas pasan con **ocho segundos de preparación y 900 ms de retorno**, sin reintentos: inclinación 5,52°, retorno 595/599/615 ms, primera oscilación y retorno monótono. Certificado `release-1726/cover-frame-bounded/certification.json`, SHA-256 `6b9a88a7cb4b5680a0309562fd60438bfffd7554fb9ad847cb8c26f3439db3db`. Se conservan el intento CDP directo fallido y el diagnóstico preliminar sin límite explícito de preparación. Este ajuste afecta al observador, no al reloj, calidad ni animación del producto; necesita su nueva batería CI.

El archivo EPUB se lee una vez al abrirlo y zip.js conserva la descompresión y validación originales. Los capítulos se decodifican desde bytes en memoria y los recursos mantienen su MIME. Siete pruebas con el ZIP real contrastan todas las entradas con el lector anterior, bloquean las operaciones posteriores de Blob/Response y comprueban codificación, buffers y archivos incompletos. Los dos intentos iniciales con errores del harness permanecen separados del aprobado. Con las fases del paginador y el puente nativo pasan 22 focales en tres archivos.

El [ensayo Android 37146839908](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/37146839908), fuente `ccd3e67`, conserva **FAILED**: 114 starts/dones, 228 callbacks recibidos y capítulos 0–18, pero ningún PCM nuevo en los últimos 30 segundos. La última observación espera una sección EPUB; los capítulos anteriores muestran brevemente ese mismo estado. No demuestra por sí sola qué operación interna queda pendiente. El nuevo registro directo de fases añade sólo valores numéricos y booleanos en los puntos originales, sin nuevos timers, evaluaciones JavaScript ni comandos de reproducción. El gate de continuidad sigue intacto. No se publicó una APK fallida.

La web 1.7.25 está publicada: fuente `ccd3e673805b63c6f173d7ec5905888a1583a324`, Pages `51e39703e23e664cbc31074dd1399270581d3c6a`. La batería local final pasó **2.511/2.511 unitarias en 152 archivos**. La segunda tanda pública pasó **5/5**, sin omisiones ni reintentos, con 110 cuerpos HTTP autenticados. Certificado `public-ccd3e67-attempt2/certification.json`, SHA-256 `e09a7bb388476de990819ad7bef24727bef750ec5c5e103c4b3a412b27197a29`. La primera conserva **4 aprobados y un fallo HTTP 503**. El caso EPUB usa un sink PCM controlado; no acredita AudioTrack bloqueado.

La batería CI original de `40490ea` pasó **2.500 unitarias y 509 E2E**; la de `a94f895`, **2.507 unitarias y 509 E2E**. Sus once archivos originales, doce jobs y censos se contrastaron por separado, sin reintentos, omisiones ni flaky. Los 220 WAV originales de la primera matriz coinciden con sus mediciones: PCM real, diez hashes distintos por idioma, un worker y cero solicitudes externas después de instalar las voces. Esa prueba no acredita acentos regionales ni resuelve la continuidad Android.

La cuenta Google real sigue sin verificarse: el navegador con sesión perdió la conexión y el navegador integrado no expuso la ventana de autenticación. Se canceló ese intento; no se declara ningún login ni subida real completados. La APK pública conserva la versión 1.1.3, código 16; 1.1.4 necesita superar continuidad, controles y PDF con pantalla bloqueada.

## Cambios de 1.7.25

La apertura del lector mantenía visibles los controles antes de completar la carga real del motor y de la posición guardada. Un observador sobre la fuente pública `40490ea` confirmó que durante ese intervalo todavía no existía un rango EPUB legible. La corrección mantiene los controles ocultos y las acciones superiores inertes hasta terminar; muestra un estado discreto de carga, limpia los fallos y conserva las transiciones de portada existentes.

El [ensayo Android 37145835659](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/37145835659), fuente `a94f895`, falló antes de iniciar el audio: después de descargar la voz, la fila «Voz» para cerrar el catálogo había quedado fuera del área visible. No hubo lectura con pantalla bloqueada ni datos para localizar el await pendiente. Se conservan el ZIP original de 105 miembros, SHA-256 `d2373d13db7c91b2a93dcdd36fd0492eba68a213e6c73a65aab7d00a5e8eb1a5`, y el certificado de captura, SHA-256 `3e5b56722285664f93daa3f3c7b70a16a9a5c341ff07e560964b9c23714998a7`. La corrección limita la altura del catálogo ampliado y desplaza su raíz, conservando el botón visible y alcanzable.

Verificación local: **80/80 focales en tres archivos** y **2/2 E2E móviles**, sin reintentos. El caso de carga retiene el módulo real y comprueba que, al liberarlo, existe texto EPUB legible; el de catálogo comprueba el hit test del botón después de desplazar hasta M5 y cierra el menú. Su captura se revisó visualmente. Originales `.animation.local/release-1724/catalog-ready-unit.*`, `reader-ready-catalog-e2e.*` y `reader-ready-catalog-build.log`. La batería completa anterior al último ajuste del catálogo pasó **2.510 unitarias en 152 archivos**; no sustituye la batería de la fuente final, cuyo censo esperado es 2.511 unitarias y 511 E2E.

La tercera tanda pública anterior pasó **3/3**, sin reintentos ni omisiones, sobre `a94f895`, Pages `782752125dee716296686e348da1cf1cede944e4`: continuidad EPUB con modelo real y sink controlado, ampliación de las voces anteriores con PCM real también sin conexión y gesto isométrico. Conserva 78 cuerpos HTTP autenticados y las capturas revisadas. Certificado `.animation.local/release-1724/public-ready-a94f895/certification.json`, SHA-256 `ef913a157334948ed38de86bf3634c313f854d9f7cb29ba9e5fb116cc7f86767`. Esa tanda esperó un rango EPUB legible antes de evaluar las voces; no acredita por sí sola la nueva corrección de carga ni AudioTrack Android. Los dos fallos públicos anteriores siguen separados.

## Cambios de 1.7.24

La fuente `40490ea6651497f8a65e4212900262e24cf969c4` está publicada en Pages `ed3e097ed6a131c7e49ba4f6b70067cce600fb2b`. HTTP confirma los 22 módulos actuales, 43 recursos offline y los chunks antiguos recuperados. Certificado `artifact-1724-40490ea.json`, SHA-256 `4c975e441981e6a965e676de5ad7954e39ba3f3d9e5382981538ce3b386e88ce`. La comprobación aislada de los diez perfiles Hindi pasó 10/10, sin reintentos, con WAV reales y salidas propias.

Las dos primeras tandas públicas conservan cada una dos casos aprobados (EPUB y estantería) y un fallo en la ampliación de voces. La primera se cerró durante la preparación del caché; la segunda descargó y verificó el paquete original, pero al iniciar la lectura encontró «sin texto legible» y no produjo audio. No se presenta ninguna de esas tandas como aprobada ni se atribuye ese fallo al modelo sin localizarlo. Originales `public-three/` y `public-three-real-download/` en `.animation.local/release-1724/`.

El observador de navegación añade estados numéricos para localizar los awaits originales del paginador: carga de sección, carga del iframe y anclaje. No añade tareas, timers, microtasks, eventos ni una navegación alternativa. Pasaron 32 focales y 74 verificaciones Python; los dos intentos iniciales con errores del harness se conservan. Este cambio es diagnóstico: requiere otro ensayo Android y no acredita haber corregido la pausa.

Supertonic pasa de tres a diez perfiles reales, F1–F5 y M1–M5, en los 22 idiomas compatibles de la app: 220 combinaciones, junto con 39 opciones Piper existentes. Son 259 opciones de idioma y voz; los perfiles compartidos no equivalen a 259 personas ni acreditan acentos regionales nuevos. Las voces usan los [perfiles originales de Supertone](https://huggingface.co/Supertone/supertonic-3/tree/3cadd1ee6394adea1bd021217a0e650ede09a323/voice_styles), fijados por revisión, tamaño y SHA-256.

El paquete completo tiene 17 archivos y 210.204.134 bytes. Los siete perfiles nuevos suman 2.039.325 bytes. Se admite sólo el manifiesto anterior completo y exacto; sus voces siguen disponibles sin conexión y una ampliación fallida conserva ese manifiesto. La interfaz muestra «Ampliar voces» y 2 MB adicionales cuando ya existe el paquete anterior. El worker anterior se sustituye al elegir un perfil nuevo, conservando una sola sesión; descargar la ampliación no interrumpe la reproducción actual.

Las pruebas focales de almacenamiento, motor e inferencia pasaron 82/82, y las de catálogo y menú 153/153 en sus tandas propias. La primera batería completa conservó 2.499 aprobados y un fallo: el contrato del catálogo todavía aceptaba sólo F1/M1/F2. Actualizada esa expectativa a los diez perfiles conocidos, la batería pasó **2.500/2.500 unitarias en 151 archivos**, con un worker y los plazos originales. Los dos resultados están separados en `.animation.local/voice-expansion-1724/full-unit-one-worker.*` y `full-unit-final.*`.

La matriz local conserva **FAILED**: 219 casos aprobados y Hindi M5 fallido al cerrar el contexto por un archivo de traza ausente en la salida compartida. Los 220 audios originales sí se generaron y sus WAV, hashes, muestras, duración y niveles coinciden con las mediciones; diez hashes distintos por idioma, un worker y ningún refetch de modelos ni solicitud externa después de la instalación. Esa revisión de audio no convierte el último caso ni la tanda en aprobados. Originales `.animation.local/voice-expansion-1724/real-220.*` y `audio/`; revisión `real-220-failure-review.json`, SHA-256 `6e40764e83826a591d3c4b289b41952f379a58e998fbb7523b8052dd42702bc0`. La comprobación aislada de Hindi, la batería CI de esta fuente y la publicación conservan sus resultados nuevos por separado.

El [ensayo Android 37143366912](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/37143366912), fuente `4a5fb86`, conserva **FAILED**: 368,370 segundos bloqueado, 114 starts/dones y capítulos 0–18, pero los últimos 54,949 segundos sin PCM nuevo. Los 228 callbacks y 38 snapshots POST llegaron completos. POST8/32 acredita `ttsDones:114`, `advanceStage:next-turn`, `followPending:0` y `pageTurnPending:1`: la continuación espera navegación EPUB; todavía no localiza su await interno. Pausa/Detener/PDF no se alcanzaron, no se publicó APK y despertar no cuenta como aprobado. Certificado `.release.local/android-1.1.4-build-37143366912/failure-review-native8.json`, SHA-256 `2d858a58939d046602cd3bd3486a3a13bb151d98859e4dd28a62d211d8060cb5`.

La prueba con una cuenta real de Google sigue sin acreditarse: el navegador con esa sesión perdió su conexión antes de verificar el login. Los casos de Drive con respuestas controladas conservan su alcance anterior; no sustituyen autenticación ni sincronización con una cuenta real.

## Cambios de 1.7.23

La tanda local posterior pasó **2.490/2.490 unitarias en 151 archivos**, con dos workers, los mismos plazos y sin build simultáneo. Conserva separado el primer intento con tres timeouts. Dos casos públicos propios de esta fuente pasaron sin reintentos y 58 recursos HTTP coincidieron con Pages; el caso EPUB usa modelo real y sink PCM controlado, no AudioTrack Android. Certificados `.animation.local/release-1723/local-unit-certification.json`, `.animation.local/release-1723/public-two/certification.json` y `.animation.local/final-live-evidence/artifact-1723-dcf4e91.json`.

La prueba de papel/cierre ahora espera que el parser real termine el recuento de la revisión importada, con el plazo de metadatos existente de 30 segundos. Antes cerraba mientras el libro todavía estaba en «Preparando…», donde la app deliberadamente no inventa geometría ni una animación 3D. Se conservan las fases, colores, comprobaciones de píxeles, cierre de 120 segundos y plazo global de 240 segundos. Pasaron los nueve casos sin reintentos sobre el build local 1.7.23. Sus originales permanecen en `.animation.local/close-metadata-1723/`; no sustituyen la batería CI.

El ensayo nativo `37141831816` sobre `dcf4e91` también falló: 114 fragmentos, 19 capítulos y 228 callbacks emparejados; los últimos 57,323 segundos quedaron sin PCM. La corrección del cooldown no basta. No se publica una APK fallida. El observador añade dos snapshots numéricos acotados después del microtask del mismo evento de reproducción, sin timers, polling, nuevas evaluaciones ni cambios de progreso; un nuevo ensayo debe localizar el punto pendiente.

El ensayo diagnóstico `37143201007` se canceló porque su filtro de logcat omitía el nuevo tag POST y no podía conservar la observación buscada. El build terminó y la captura figura cancelada tras un segundo, sin checkpoints ni artefactos de audio. Se añade el tag al filtro, con una regresión que exige conservar sus bytes en el log original. No se presenta ese ensayo cancelado como resultado de audio ni se relajan sus gates.

La batería CI original de `dcf4e91`, run `37141659571`, conserva su resultado **FAILED**: 2.490 unitarias aprobadas y las 355 identidades E2E presentes, con 352 resultados esperados, dos fallidos y uno flaky. Los once ZIP autenticados y doce logs originales se conservan en `.animation.local/release-1723/ci-failed-exact-37141659571/`; certificado SHA-256 `ea556d1518cfa8b0d4dcd7c225e3560d5779a134f94d4b14484679c4bad263d9`. No se presenta el total de casos como una aprobación completa.

El caso de planta junto a un libro fino también recargaba antes de completar el recuento real del PDF importado. Ahora espera la misma revisión completa antes de cerrar y recargar, conservando el plazo total de 90 segundos y sus comprobaciones de visibilidad y zonas táctiles de ocho segundos. El caso original pasó localmente sin reintentos en 31,7 segundos; sus resultados permanecen en `.animation.local/plant-metadata-1723/`. La nueva batería completa debe comprobar esta preparación junto con las demás pruebas.

El paso de capítulo EPUB no espera el retardo visual de 100 ms si la app está oculta, ni si se oculta mientras espera. Conserva carga, disposición de página y bloqueo hasta el mismo endpoint; los 100 ms visibles y su limpieza siguen comprobados. El paginador real extraído reproduce el bloqueo anterior con el timer suspendido. Diez focales pasan; el baseline anterior conserva cuatro fallos. Certificado: `.animation.local/release-1722/hidden-cooldown/certification.json`, SHA-256 `61e4dc70c63a92b8722cff31af683995c20ae47a8f88489b1aae54451b01206c`. Esto acredita esa dependencia, no identifica por sí solo la causa exacta de la pausa nativa.

El despliegue cambia `force_orphan` a `false` junto con `keep_files: true`: la implementación de Actions omitía la conservación al crear una rama huérfana. Se recuperaron ocho módulos inmutables de Pages `c0cc524` en `c01f1c21a54f18e301c98a390efa6ea97dd72907`; doce recursos HTTP coinciden con Git y los 91 archivos existentes de 1.7.22 permanecen idénticos. Los módulos PDF y EPUB que devolvían 404 vuelven a estar disponibles. Se conserva la prueba fallida anterior del contrato de despliegue y los dos focales corregidos. Esta versión necesita su propia batería completa y comprobación pública.

La primera tanda local de 1.7.23, ejecutada mientras se compilaba, conserva **2.487 aprobados y tres timeouts de 5.000 ms**, en dos archivos de modelos 3D: no se presenta como batería aprobada. Sus JSON y log originales permanecen en `.animation.local/pages-reader-retention-1722/full-unit-1723.*`. El build pasó; las pruebas nuevas del cooldown y del contrato de despliegue pasaron. La comprobación completa posterior debe conservar su propia fuente, perfil y resultados.

El [ensayo Android 37140077910](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/37140077910), fuente `ea76f782`, permanece **FAILED**: 108 fragmentos y 18 capítulos, con 216 de 216 callbacks recibidos; no hubo PCM nuevo en los últimos 30 segundos y la cola estuvo vacía 65,53 segundos. Despertar recuperó la lectura en unos 0,5 segundos, en una captura diagnóstica posterior al fallo. El snapshot precede el microtask de avance y no localiza el await exacto. No se publicó una APK ni se considera aprobada por esa recuperación. Revisión original `.release.local/android-1.1.4-build-37140077910/failure-review22.json`, SHA-256 `df9d753927c1a42fde5b4337f3aa806326cbf6d04be25aceccbf77cd4f6e45e9`.

La web real de 1.7.22 pasó dos casos propios sin reintentos: EPUB con motor/modelo reales y sink PCM controlado, y el gesto isométrico completo. Se autenticaron 54 cuerpos HTTP. Certificado `.animation.local/release-1722/public-ea76f78/certification.json`, SHA-256 `dc784283b4c7a6af3db33af828fbb86baf0f6a4059f953f3a308f3f172aeebbd`. Estos casos no certifican audio nativo bloqueado. Su batería completa sigue separada de 1.7.23 y del aprobado de 1.7.21.

## Cambios de 1.7.22

Se corrige el índice EPUB usando la forma real de `SectionProgress.section.current`, con compatibilidad para un índice explícito válido. Las diez regresiones fallan en cinco casos con el código anterior y pasan con la corrección. Junto con los diagnósticos numéricos de audio, pasan 498 pruebas focales distintas en 37 archivos; la batería completa y el despliegue de esta fuente se verifican por separado. El observador Android pasa 73 pruebas Python y ahora rechaza la cola vacía del último intervalo de 30 segundos del fixture Lessac. Estos resultados no acreditan que la pausa al bloquear Android esté resuelta.

Estado: 3 de octubre de 2026. La implementación web verificada corresponde a `b98265e409bd4b67533c9e44c9361245cf0687cc`. El cierre `a61703640c3a23a6708baf081099992758ef0a15` modifica sólo observadores, preparación de pruebas y harness de Android; conserva el producto web. Las correcciones posteriores de 1.7.22 no heredan este aprobado.

## Web 1.7.21 entregada

- **Vistas por gesto:** izquierda para isométrica y derecha para frente, sin selector separado. Se conservan scroll vertical, pinza, pulsación larga, arrastre y teclado; soltar el gesto no abre el libro tocado.
- **Relieve de varios colores:** hasta diez colores realmente encontrados en la portada, seleccionables simultáneamente, con intensidad independiente. Ajustar uno conserva los mapas y materiales de los otros, incluida su frontera; la tinta original no cambia. La elección persiste al reabrir y admite los perfiles antiguos de un solo color.
- **Grosor por palabras:** recuento completo del texto extraíble de las páginas PDF y secciones EPUB, con una equivalencia de 300 palabras por página impresa. Los bytes se guardan antes del análisis; una cola por revisiones descarta recuentos antiguos y mantiene el libro accesible durante la preparación. Los cómics reconocidos sin texto completan con cero palabras.
- **PDF adaptable:** avanzar y retroceder recorre el contenido de una página larga antes de cambiar de página PDF. El ancla visible se conserva al cambiar fuente, tamaño, orientación o reabrir; se corrige la carrera entre scroll y resize. El seguimiento de voz revela el texto correcto y el renderizado pendiente continúa al ocultar la pestaña, con cancelación y limpieza de sus observadores.

## Batería completa y publicación

[CI 37137687058](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/37137687058), fuente exacta `a61703640c3a23a6708baf081099992758ef0a15`: **2.465/2.465 unitarias en 148 archivos y 355/355 E2E**. Se contrastaron los doce jobs, once ZIP originales, sus digests y doce logs con el censo de esa fuente. Cada E2E tiene un único intento aprobado: cero omisiones, duplicados, skips, flaky, reintentos o errores.

| Suite E2E | Aprobados |
|---|---:|
| UI 1 / 2 / 3 / 4 / 5 / 6 | 44 / 38 / 37 / 41 / 36 / 30 |
| Voces: motor / lectura / idiomas | 9 / 14 / 40 |
| Supertonic | 66 |

Certificado: `.animation.local/release-1721/ci-next-37137687058/certification.json`, SHA-256 `eff84eda5b03fd4b62700665003bbc148106aa9526faabbed31676e2bc1d851c`. Revisión de todos los intentos: `suite-results-review.json`, SHA-256 `2eef222c3cbd24599320fe91fb4f45ba4c1f9a08b9270d79797cb7de1c13a786`.

Además pasaron **20 casos públicos distintos**, complementarios a CI: ocho PDF, dos de recuento, un smoke isométrico, uno de zoom, siete del editor y uno de retirada/reimportación desde Drive. Mantienen sus fuentes y fechas originales: `b98265e409bd4b67533c9e44c9361245cf0687cc`, Pages `e9425392607d2f3ea5fc1978c8c726b55236e30e`. Se autenticaron los cuerpos de los módulos recibidos sin reemplazar código de la app. El primer intento Drive con sellado de cuerpos incompleto se conserva y no se suma a esos veinte.

El despliegue de `a617036` ([37137687016](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/37137687016)) produjo Pages `c0cc5240c7584e615426ae8e3ec9971c0ba1b282`: **91 archivos idénticos** al Pages ejercitado, árbol `dae19b817c41fd997a73a393d00afec1bfbb8979`. Se contrastaron de nuevo 50 recursos HTTPS únicos. Entrada: `assets/main-jQpZcnwh.js`, 1.409.642 bytes, SHA-256 `af4fddc0736d38d29607c83e394a1cf001483f8a27020285085cf8d969b1f0bf`. Equivalencia: `.animation.local/release-1721-testclosure/public-equivalence-a617036.json`, SHA-256 `648e77efd8e7c0bbcba233f6867f77ad441dc7cbc80635ba94efaf5ce5372a57`. Esto acredita bytes iguales; no reetiqueta las pruebas públicas como ejecuciones sobre `a617036`.

El observador software de interrupción usa **2.200 ms en CI**; el límite local sigue en **900 ms**. Se conservan el fallo local de 904,2 ms y los originales de CI de 1.802,2/1.812,5 ms frente a 1.500 ms. La calibración conserva reloj, poses, resolución y calidad: no acredita una mejora del rendimiento ni un límite garantizado de fotogramas. El run rechazado `37134706176` y sus intentos originales permanecen separados.

## Pendientes y límites

- **Configuración gráfica forzada adicional:** el perfil original local y publicado pasa dentro de ocho segundos. El caso público con los tres flags ANGLE/SwiftShader conserva FAILED en 9.274,7 ms; los experimentos posteriores no se publican. Resolución, materiales y relojes originales permanecen. La causa específica de esa diferencia sigue sin acreditarse.
- **Cuenta Google real:** falta una sesión autenticada disponible para comprobar login y subida reales. Las pruebas de Drive con respuestas controladas y el preflight público no sustituyen esa comprobación.
- **Prueba en teléfono físico:** Android 1.1.4 sí pasa continuidad y controles en el emulador original. Sigue sin acreditarse su calidad acústica, FPS, temperatura, batería ni reproducción indefinida en un teléfono físico.
- No se añade OCR ni se garantiza el orden perfecto de cualquier PDF. La evidencia histórica mantiene sus propios resultados y alcance.

El [informe de 1.7.19](pdf-reading-continuity-1719.md) y los históricos siguientes conservan sus resultados; sus cifras no se suman a la batería actual.

## Histórico certificado — web 1.7.18 y APK 1.1.3

Estado: 3 de octubre de 2026. El relieve por colores está publicado desde `7be235b78ac769426b44c03abe65dbcf119ad6ca`. La verificación final usa `8936abedd970ac50b65925c2d51e699aabcb80a4`, que sólo corrige la espera de devolución antes de una importación en un test E2E. Pages actual: `d85b2321d18408dc887abdda08a6be8baf5e314f`; entrada `main-Bttpz-IX.js`.

**Batería completa aprobada:** 2.191 unitarias en 128 archivos y 335 E2E, 206 UI y 129 de motores reales. [Run 37118962162](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/37118962162): 12 jobs y 11 ZIP originales contrastados, 21 JSON y 89 PNG de interfaz, sin omisiones, reintentos, flaky ni errores. Certificado agregado SHA-256 `f58abd154ad0c094837d821b8bd6e137d998eba28d77b5750896828a47f4790a`.

El editor ofrece hasta tres zonas de colores reales distintos, con relieve y barniz localizados. Conserva el color elegido y la intensidad al reabrir. El análisis se prepara en tareas cancelables y reutiliza los mapas al cambiar la intensidad. Las portadas monocromas o bicolores ofrecen sólo sus opciones reales.

Pasaron **18 casos locales** de portada y **20 casos sobre la web publicada**. Se compararon por HTTP 20 módulos y estilos y 40 archivos del shell offline; la publicación posterior conserva sus 85 archivos de Pages idénticos. Las ejecuciones originales mantienen sus fuentes y fechas. La revisión de voces final verifica 106 WAV nuevos.

La APK pública 1.1.3, código 16, volvió a descargarse y mantiene su firma V2 y loader de 2.089 bytes, sin una copia empaquetada de la app. Las mejoras llegan mediante la web. [Implementación, certificados y alcance de 1.7.18](cover-color-relief-1718.md).

## Histórico certificado — web 1.7.17 y APK 1.1.3

El bloque siguiente conserva la fuente, fechas, censos y alcance originales de 1.7.17.

Estado: 3 de octubre de 2026. La optimización de rendimiento está publicada desde `64a91da1ff688d9bd0d3fe9d8e511fbf2d8548ca`, Pages `ae809d710a76a00eda4aa69a5f65276dd93e6915` y entrada `main-BL7jM-hN.js`.

**Batería completa aprobada:** 2.141 unitarias en 127 archivos y 331 E2E, sin omisiones, reintentos, flaky ni errores; [run 37113842421](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/37113842421), 12 jobs y 11 ZIP originales contrastados. Son 202 casos UI y 129 de motores de voz reales. También pasaron **20 casos sobre esta publicación**, con fuente y artefacto fijados.

Se comprobó por HTTP el contenido de 20 módulos/estilos y los 40 archivos del shell offline. La APK pública 1.1.3, código 16, volvió a descargarse: conserva un loader de 2.089 bytes sin una copia vieja de la app. Las mejoras de JavaScript llegan mediante la web; no se generó otra APK para esta entrega.

El PDF reutiliza las páginas válidas, la escena evita el trabajo oculto, las plantas conservan su geometría al ampliar y el marcapáginas reutiliza sus buffers. La comparación mantiene texturas, iluminación y sombras; la estantería estática y las vistas de inspección comparadas conservan los mismos píxeles. [Mediciones, fuentes, certificados y límites de 1.7.17](performance-1717.md).

## Histórico certificado — web 1.7.16 y APK 1.1.3

El bloque siguiente conserva la fuente, las fechas, los censos y el alcance originales de 1.7.16.


Estado: 3 de octubre de 2026. **Batería completa aprobada: 2.086 unitarias en 123 archivos y 330 E2E**, sin omisiones, saltos, reintentos, flaky ni errores. El [run 37110847248](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/37110847248) corresponde a `6822ae282c02573a98c88bd98087efdc855c8d69`; sus 12 jobs y 11 ZIP originales se contrastaron con el censo de esa fuente. Son 201 casos UI y 129 de voces reales: motor 9, lectura 14, Piper 40 y Supertonic 66.

El certificado `.animation.local/ci-37110847248/aggregate.json` tiene SHA-256 `363888d41846ad0d9336f41c91734da59994ec863c3720847de0a9b53db3b75e`. La revisión semántica de voz, incluidos 106 WAV, tiene SHA-256 `3930134329b1024ef223850c88471e5bf2c2c92005e01f8aea51c2097e279d1a`.

## Publicación y alcance de 1.7.16

- **38 casos públicos aprobados**: 36 de aplicación y dos de Supertonic, con la fuente original `c29ac806174859347a632cd22cc4d1f8818f1bc1`, Pages `a2c676cf628d2c3b48dba7c67248016bcfb9a854` y entrada `main-CpRyO9Jy.js`. Sus originales no se renombraron ni se repitieron para la publicación posterior.
- El commit 6822 sólo cambia cinco archivos de verificación. Pages actual `5fe4f3a16e62717297feb2ff593c60f9db71b89c` conserva **los 85 archivos idénticos**, árbol `ee2ab98c1bd58a78d37390358c8f508a10048166`; HTTP confirma entrada, 20 módulos y 40 recursos del shell. Certificado: `.animation.local/1716-contract2-public-equivalence.json`, SHA-256 `94e4d105dbf5e5ac5e3f2e07d1cb2e2bcd9a08c0f8291c0206700b578a628050`.
- Los tres focales de catálogo/importación y los dos de interceptación del worker pasaron por separado. Se conservan los certificados fallidos iniciales de los observadores y sus suplementos de sólo lectura, sin alterar resultados ni repetir pruebas.
- El APK público **1.1.3, código 16**, volvió a descargarse y conserva su loader de **2.089 bytes**, sin una copia completa antigua de la web. SHA-256 del APK: `67a52bdebff36c889c81061c488d002f4ac881404e9d1a5f6ad49e909ce267f7`. Su prueba nativa conserva la certificación independiente del histórico; esto no acredita un teléfono físico nuevo.

[Implementación, licencias y evidencia de 1.7.16](overnight-polish-1716.md). Se mantienen biblioteca local/offline, subida manual a Drive, libros y plantas proporcionados, páginas PDF sincronizadas con el inicio audible y conservación de imágenes. El catálogo suma **105 opciones de idioma y voz**, no 105 personas; Supertonic es una descarga manual compartida de unos **209 MB** y Piper sigue siendo predeterminado. Hebreo, serbio y chino tienen una voz cada uno. El PDF complejo conserva la página impresa original cuando no se pueden aislar sus imágenes.

Las medidas LIVE Supertonic (RTF 1,74–1,88 en los primeros fragmentos), las de CI y las del benchmark histórico se documentan por separado. No se promete lectura universal sin pausas ni se certifican RAM, batería o temperaturas de un teléfono físico.

## Histórico certificado — web 1.7.14 y APK 1.1.3

El texto siguiente conserva su fecha, fuente y alcance originales. No describe el catálogo actual de 1.7.16 ni se suma a los censos actuales. El [informe de 1.7.15](overnight-polish-1715.md) también se conserva como histórico.

Estado: 3 de octubre de 2026. Batería integrada y publicación confirmadas para el commit `506f7ef08c3e7dddaddc4e5ce6a63313756710e5`.

## Cambios entregados

- El lector ofrece sólo las 36 voces naturales del catálogo y sus 27 idiomas base. Las preferencias antiguas de voz del dispositivo se convierten en selección automática natural.
- Daniela (Argentina) conserva la lectura cuando sintetizar tarda más que reproducir: espera el fragmento completo en lugar de descartar la voz o recurrir al dispositivo. Pim (neerlandés) reutiliza el diccionario incluido en el paquete.
- PDF prepara una única página siguiente sin mostrarla durante la síntesis, y la activa con su resaltado cuando empieza su continuación audible. Pausa, navegación, cambios de vista y fuentes tardías descartan la preparación.
- EPUB divide las frases por los cortes reales de página y avanza al empezar a sonar la continuación. Conserva el texto y el resaltado; la preparación y los eventos de una lectura cancelada no giran la página.
- El lector mantiene la pantalla encendida. Android oculta la barra de estado completa, incluida hora e iconos. Al cerrar o pasar a segundo plano se liberan los recursos y se restaura la barra; al regresar se aplica de nuevo la política.
- El papel de los libros 3D es blanco; pasa al color del lector durante el acercamiento y vuelve al blanco al cerrar.
- Los toques de libros y luces se resuelven al soltar un contacto válido. Su click de compatibilidad se consume antes de que pueda activar la nueva portada o cerrarla mediante su fondo. Se conservan teclado, ratón, contactos nuevos, arrastre, cancelación y pinch.
- El audio ofrece los cinco pasos accesibles de velocidad: 0,75×, 1×, 1,25×, 1,5× y 2×, con teclado, foco, persistencia y disposición a 320 px.
- El catálogo incorpora portugués de Portugal, búlgaro, serbio, hindi y hebreo, con 33 modelos para 36 voces. Hebreo instala también Nakdimon. Pesos, configuración y diccionarios se conservan para sintetizar desde caché.

## Batería completa

[Production checks 37100354260](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/37100354260) terminó correctamente: **1873/1873 unitarias en 109/109 archivos y 246/246 E2E** (187 de interfaz y 59 con motores reales), sin omisiones, reintentos, resultados flaky ni errores globales. Los once jobs, incluido el resumen, terminaron con éxito. Los informes originales y el censo independiente pertenecen al mismo commit.

El censo de interfaz es 187 (41 + 32 + 33 + 27 + 26 + 28 en seis shards). Los motores reales suman 59 (9 engine, 13 reading y 37 languages). Cada job guarda su manifiesto `--list` y compara las identidades de proyecto, archivo y título con los resultados. El guard rechaza omisiones, duplicados, skips, flaky, retries y fotogramas no observados; el resumen exige el éxito de todos los jobs.

La tanda local 1.7.14 pasó 1873/1873 unitarias en 109/109 archivos. Los 47 focales PDF y los 88 de ReadingVoice/Controller también pasaron. El nuevo E2E de PCM real reproduce el fallo anterior: la página se adelantaba aproximadamente 1492 ms en 1.7.13; los originales se conservan en .animation.local/pdf-audible-page-1714/. Las ocho regresiones del scheduler y las once existentes de papelera de 1.7.13 pasaron 19/19. La prueba original de retirada pasó sin reintentos; el focal de caché 53/53 de 1.7.12 se conserva como histórico. Las comprobaciones locales de luces y gestos de 1.7.11 se conservan como histórico: Cuatro casos originales de luces y gestos pasaron 4/4 con manifiesto y shard 1/1. El caso original de acabados pasó 1/1 sin shard, con un censo independiente; este último resultado no se presenta como aprobación del guard que exige shard. Ninguno necesitó reintentos. Los cambios de voz comprueban la interrupción de PCM que aún está sonando y la cancelación durante síntesis sin nodos de audio activos.

El focal de acabados conserva su certificado en `.animation.local/lamp-diagnostic/final-finish-census.json` y sus mediciones en `final-finish-metrics.json`, junto con el manifiesto, el resultado original y la traza.

Evidencia final: `.animation.local/ci-37100354260/`, con manifiestos, JSON, trazas, capturas y logs. Las tandas históricas canceladas o fallidas se conservan separadas. El run 37083409316 confirmó 1793 unitarias, engine 9, languages 37 y los shards UI3/4/5 (86 casos), pero la prueba de inactividad esperaba Claude después de que la de cancelación dejara Davefx seleccionado. Sus dos intentos fallidos se conservaron y no acreditan una aprobación completa. Se añadió una selección explícita de Claude a la preparación de esa prueba; no modifica el runtime. Los shards restantes de ese run se cancelaron automáticamente al iniciar el nuevo workflow.

El run 37084412928 completó las 1793 unitarias y todas las identidades E2E, pero los dos casos de balanceo de portada fallaron en ambos intentos. Sus cuatro trazas muestran el movimiento real de ±8,48°; la espera por RPC no observó la condición transitoria y terminó con ángulo 0. La comprobación corregida observa las poses pintadas en el navegador, conserva amplitudes, persistencia y Sin relieve, y exige que un gesto confiable llegue con el libro inclinado y lo devuelva a cero dentro del plazo original. Los dos focales pasaron sin reintentos; el gesto llegó a 5,34° y el retorno tardó 314,1 ms. El commit a0304d2 cambió sólo esas dos observaciones de prueba; el runtime y la APK conservaron sus bytes. Los informes fallidos siguen en `.animation.local/ci-37084412928/`.

El run 37086267027 también completó las 245 identidades, pero se rechazó por un cierre Android intermitente y por el plazo de interrupción más estricto, ahora medido desde el evento real. En sus dos intentos, el gesto llegó durante el primer vaivén y el retorno tuvo cuatro poses monótonas; el renderizado por software tardó 1027,5 y 1042,6 ms. La animación conserva su reloj de 240 ms. CI usa el perfil explícito de 1500 ms, y la prueba exige primer ciclo, gesto confiable, inclinación, retorno monótono y reposo. El límite local sigue siendo 900 ms.

En el cierre frío de ese run, la traza muestra el vuelo todavía avanzando a los 30 s y el libro insertado visualmente a los 33,3 s, antes de cerrar el contexto. No se capturó el estado final del body de aquel intento; su reintento tampoco se usa como aprobación. Los casos de importación usan 60 s de observación y 120 s totales sólo en CI, manteniendo 30/60 s locales y las comprobaciones de bytes exactos, comienzo de cierre, estado final y libro visible. Los dos focales actualizados pasaron juntos sin reintentos con los límites locales: cierre en 15,424 s y gesto en el primer lóbulo con retorno de 468,5 ms. Las pruebas conservan el renderer y cada fotograma. Evidencia histórica y focal: `.animation.local/ci-37086267027/`.

El run 37088539879 completó todas las identidades: 1793 unitarias en 106 archivos y 245 E2E, de las que 244 pasaron sin reintentos. Se rechazó por un caso intermitente de la vista móvil walnut. La comprobación leyó el endpoint isométrico 12 ms después del toque, antes del siguiente render: el stage ya medía 626 px y el canvas conservaba los 783 px frontales. La traza muestra la vista isométrica completa y estable 374 ms después del toque. La prueba espera ahora el endpoint y la geometría final dentro de sus 8 s originales; conserva todas las exigencias de alineación de 1 px, ausencia de scroll y controles. Los dos casos móviles focales pasaron 2/2, en 32,576 s, sin reintentos y con guard normal. No cambia el runtime ni se usa el reintento del run anterior como aprobación. Evidencia: `.animation.local/ci-37088539879/`.

El run 37090203031 también completó las 245 identidades, pero la reutilización de la página falló en ambos intentos de la reapertura: 244 casos aprobados y uno fallido, con 1793 unitarias y 58 voces reales correctas. El probe natural reprodujo una clave preparada en top=48 y consumida en top=47, con tamaño, contenido, preferencias y generación idénticos, sin invalidación intermedia. Un experimento separado con el DOM y CSS reales identificó el control invisible después del shell: creaba un documento de 845 px para un viewport de 844 px. Desplazar el documento un píxel reprodujo exactamente top=47; anclar sólo ese control en top=0 devolvió scrollHeight=844 y top=48. Se conservan el fallo natural y el experimento causal por separado en `.animation.local/cache-reopen-diagnostic/`.

La corrección web 1.7.12 ancla los controles invisibles dentro de la app. Al consumir una página ya terminada, acepta una traslación rígida y rebasa sus coordenadas de destino conservando la identidad de snapshot, pixels y texturas. Mientras se prepara la página, la comparación sigue siendo estricta; tamaño, DPR, progreso, motor, preferencias, tema, filtro y generaciones se siguen comprobando. Las 25 regresiones unitarias nuevas comprueban ambas políticas, consumo único, ausencia de mutación tras un rechazo y coordenadas inválidas. El caso original de reapertura exige además scrollY=0 y ausencia de desbordamiento del documento.


El run 37092411622 completó 1818 unitarias en 106 archivos y las 245 identidades E2E, pero se rechazó por una retirada de libro intermitente: su primer intento actualizó el layout dos veces y su reintento pasó. La traza confirma que ambos layouts ocurrieron después de aterrizar, con el mismo canvas y dos libros; no había un cambio tardío antes del baseline. Un probe natural aparte pasó sin reproducir las colas, y se conserva como tal. Las regresiones deterministas reprodujeron cuatro fallos de solicitudes pendientes y registros en cola en la fuente anterior.

La corrección 1.7.13 aplica la lista más reciente antes del único layout de la retirada y consume las peticiones anteriores sólo cuando la estantería puede renderizar. Las ocho regresiones nuevas conservan ancho cero, cambios posteriores, apariencia terminada durante el vuelo y recuperación ante fallo de almacenamiento. Los 19 focales unitarios pasaron. El caso original de arrastre pasó sin reintentos, sin cambiar sus asserts del canvas, shaders, libros restantes ni número de actualizaciones. Evidencia anterior y nueva: .animation.local/ci-37092411622/, .animation.local/shelf-render-scheduling/ y .animation.local/trash-render-diagnostic/.


La batería 1.7.13 del commit e52101ab3a640dd18aa66c54bdf60027fcddb371 (run 37094685596) completó 1826 unitarias en 107 archivos y 245 E2E sin omisiones ni reintentos. Sus 23 casos publicados también pasaron. El caso de continuidad audible era EPUB; ese resultado no cubría el adelanto de página durante la síntesis PDF. La regresión nueva reproduce ese fallo en 1.7.13 y acredita la corrección específica de 1.7.14, por separado de aquella batería.

El run 37096358976 del producto b48a9928b9f2520e3ff3a3b299010b9bc7c0fd2f completó 1873 unitarias en 109 archivos y las 246 identidades E2E, pero se rechazó por dos casos de UI1 que fallaron también en sus reintentos. En selección sucesiva de libros, las dos trazas muestran el PDF y «Listo para leer» después de 9,28 y 9,16 segundos desde una espera de ocho segundos iniciada antes de revelar la portada. La portada se muestra al terminar su propia animación, independientemente del PDF; ahora se espera esa presentación con ocho segundos propios antes de los mismos ocho segundos de preparación. Se conservan el plazo global de 120 segundos, los documentos, las portadas y las aserciones originales.

En el otro caso, la prueba PDF trataba una solicitud pendiente de síntesis (atStart:null) como si ya hubiera empezado. El segundo intento comparaba la última solicitud con una reanudación después de que el fragmento anterior ya hubiera terminado y se hubiera preparado la página siguiente. La observación corregida registra request y start por separado, deja terminar automáticamente las cuatro frases de la primera página y sostiene el primer fragmento audible de la segunda para comprobar Pause/Resume. Conserva los textos completos, el orden, resaltados, ubicación visible, navegación manual y ausencia de cancelaciones durante el avance automático; añade la comprobación del resaltado anterior durante la preparación. Estas dos correcciones afectan sólo a tests, sin cambiar la app ni aceptar los reintentos como aprobación. Los nueve ZIP y dieciocho JSON originales del run fallido se conservan en .animation.local/ci-37096358976/.

El run 37098516046 del commit 063d8dcdf3226a6e9481d51b182a1e66a2ce6242 completó las 1873 unitarias y las 246 identidades E2E, pero se rechazó por una reapertura EPUB que falló en ambos intentos. Las dos observaciones reparadas del run anterior pasaron. El nuevo caso esperaba los controles durante toda la apertura con ocho segundos: sus últimos polls aún los observaban ocultos a 7,574 y 7,567 segundos, y los snapshots finales acreditaron la entrega correcta a 8,021 y 8,016 segundos, con flyout eliminado, body en lectura y capítulo Beyond the window. Los fotogramas muestran cubierta, apertura, marcapáginas y zoom continuos; el giro posterior todavía no se había ejecutado. Ahora esos dos caminos equivalentes de reapertura PDF y EPUB esperan primero el endpoint de la animación con los veinte segundos ya establecidos en assertOpening, y después mantienen la misma comprobación de controles de ocho segundos. El plazo global de noventa segundos, la página actual, la malla, la secuencia de cierre y la cancelación por giro se conservan. No cambia el runtime. El run rechazado, sus nueve ZIP y dieciocho JSON originales y la línea temporal siguen separados en .animation.local/ci-37098516046/.

El archivo original completo de apertura y cierre pasó 10/10 en 223,635 segundos, sin omisiones ni reintentos y con guard chromium, shard 1/1. Los bytes del test probado coinciden con el blob de 506f7ef08c3e7dddaddc4e5ce6a63313756710e5; la ejecución usa el mismo producto local 1.7.14. Se conservan páginas impresas, CFI, bisagra, marcapáginas, cancelaciones y giro. Evidencia: .animation.local/book-opening-handoff-1714/certificate.json y guard.json.

## Web publicada

La publicación 1.7.14 corresponde a `gh-pages` `ca6eaf0bdcb13974be5de9f97a4a95ef0c570971`, generada desde `506f7ef08c3e7dddaddc4e5ce6a63313756710e5`. La preparación diferida de PDF se entregó en `b48a9928b9f2520e3ff3a3b299010b9bc7c0fd2f`. El commit actual modifica únicamente las observaciones en tres archivos E2E; todos los demás archivos de Git, los veinte recursos JavaScript/CSS, las páginas HTML y el manifiesto Android son idénticos a la publicación ejercitada por los 24 casos reales siguientes. Su certificado mantiene la fuente, el despliegue y las fechas originales; no se presenta como una nueva ejecución sobre otro commit.

- Entrada real: `assets/main-CTOgfCNl.js`, 1.373.944 bytes, SHA-256 `d26c1a71687a4a42c0d1aba2738cef94f31a8194be3521bf451c099b2cf37d0f`.
- Los 20 recursos JavaScript/CSS publicados, 2.255.285 bytes, coinciden con `gh-pages`. También se comprobaron diccionarios búlgaro/hindi/serbio, avisos hebreos, fonemizador, módulo PDF compatible antiguo y manifiesto Android.
- Las **24 regresiones reales pasaron sin omisiones ni reintentos**: ocho de pantalla, continuidad audible, luces y gestos; dos de Argentina/neerlandés con pesos reales; dos de encuadre móvil; dos de preparación y reapertura; nueve de papel blanco y temas; una de retirada con layout único, shaders reutilizados y escena conservada. Cada grupo conserva manifiesto, resultados originales, traza, pin de la entrada y guard `chromium` / shard `1/1` válido.
- Argentina se comprobó a 1× y 1,25× con tres fragmentos por velocidad. Neerlandés se comprobó en selección automática y tras recargar con Hugging Face bloqueado. EPUB y PDF siguieron el inicio audible de la continuación, conservando la frase completa y sin voces del dispositivo. En PDF la huella del canvas muestreada a 32×48, sus dimensiones, el texto mapeado y el progreso de la página anterior permanecieron intactos durante la preparación y síntesis; el canvas y el resaltado siguientes aparecieron con el inicio real de Web Audio.
- PDF y EPUB conservaron la página guardada y la reutilización del snapshot. La reapertura exige scrollY=0 y ausencia de desbordamiento del documento.
- Los nueve casos de papel comprueban PDF/EPUB en papel, sepia, noche y AMOLED, más movimiento reducido: página blanca física, transición al tema al abrir y vuelta al blanco al cerrar.
- La página real de descarga mostró `android-v1.1.3` y el enlace exacto al APK; los cuatro recursos de esa página coincidieron con `gh-pages`.

Piper, pesos de Hugging Face, fonemizador, worker ONNX y Web Audio son reales. Wake Lock, el puente Android web y las API de voz del dispositivo se observan con dobles controlados. Los casos web no sustituyen la comprobación nativa del APK ni acreditan audio o rendimiento en un teléfono físico.

Evidencia: `.animation.local/final-live-evidence/artifact-1714-506f7ef-android113.json`, `chunks-1714.json`, `runtime-equivalence-1714-506f7ef.json`, `live1714/{critical,voices,mobile,prepared,white,trash}/`, `live1714/certification.json` y `download1714/`. Las tandas anteriores, incluidos fallos del entorno de prueba, permanecen separadas; no se usan sus reintentos como aprobación final.

## APK publicada

APK 1.1.3, versionCode 16, paquete `com.inhousesoftware.read`, 3.174.689 bytes y SHA-256 `67a52bdebff36c889c81061c488d002f4ac881404e9d1a5f6ad49e909ce267f7`. La firma V2 se verificó criptográficamente y conserva el certificado anterior. El loader real tiene 2.089 bytes, coincide con el repositorio y no contiene una copia empaquetada de la app ni pesos de voces. La descarga pública adicional comprobada tras publicar 1.7.14 conservó exactamente el mismo SHA, manifest, certificado y loader; el manifiesto de actualización en la web también coincidió.

El build 37080634822 pasó nueve estados nativos: estantería inicial, lector frío, segundo plano, regreso al mismo PDF, estantería, lector caliente, estantería, importación por Compartir y estantería final. En lectura, `KEEP_SCREEN_ON` está activo, `statusBars` solicitado oculto y el `InsetsSource` real invisible; el WebView empieza en y=0. En la estantería se libera el flag, vuelve la barra y el WebView empieza en y=66, valor medido en este emulador. En segundo plano se libera también el flag y vuelve la barra.

La comprobación independiente 37082246394 descargó la APK pública, confirmó su tamaño/SHA y pasó los cinco estados exigidos: estantería, lector, segundo plano, regreso al mismo PDF y estantería. Cada estado comprueba foco, flags, petición y visibilidad real de las barras; los estados en primer plano comprueban además la posición del WebView. La primera etapa abrió `accounts.google.com` con el formulario visible y sin errores de solicitud; no autentica una cuenta con credenciales. Las 42 unitarias del helper también pasaron.

La captura PNG del regreso al lector se tomó antes de estabilizarse y aún muestra la barra; se conserva como captura intermedia. Después de ella, el `InsetsSource` del volcado final acredita la barra oculta, el volcado de ventana acredita `KEEP_SCREEN_ON` y el XML acredita el mismo PDF y la posición y=0. El PNG conserva el estado intermedio previo a esas comprobaciones.

El verificador acreditó el primer regreso a la estantería a los 72,7 s en el emulador del build y a los 41,1 s en la comprobación independiente; los estados de estantería siguientes del build se acreditaron en unos 16 s. Estos tiempos incluyen espera y capturas, sin medir la duración exacta de la animación. Describen ese emulador de software, sin acreditar rendimiento ni audio en un teléfono físico. La política conserva los flags hasta terminar la devolución para evitar que el cambio de insets cancele la animación.

Evidencia: `.release.local/android-1.1.3-{apk-verification,apk-recheck-a89d,native-evidence,published-verification}.json`, `android-1.1.3-signature-verification.log`, `android-1.1.3-passing-emulator/`, `android-1.1.3-published-emulator-37082246394/` y `android-verifier-42-units.log`. El primer intento independiente 37081315869 conserva su informe fallido porque Chrome seguía pasando a primer plano; no se usa como aprobación.


La comprobación independiente adicional [37097625702](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/37097625702) instaló de nuevo el APK público después de publicar 1.7.14 y pasó los cinco estados nativos, con el mismo SHA, controles de foco, flags, `InsetsSource` y XML. El producto observado pertenece a `b48a9928b9f2520e3ff3a3b299010b9bc7c0fd2f`; el workflow y su helper diagnóstico pertenecen a `38f04260bb1c6a6d53035202e0cd01c5749b1bb6`. Git confirma que los únicos tres archivos distintos son el helper de verificación, sus tests y la activación de observadores en el workflow: no hay cambios en el runtime, el código Android ni el loader. Sus 48 unitarias incluyen las 42 anteriores y seis del observador.

El ensayo anterior [37096554823](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/37096554823) se detuvo al importar el PDF: sólo acreditó el estado inicial de la estantería, sin ejecutar los cuatro estados posteriores. Su captura final muestra la biblioteca vacía; no demuestra un fallo de la política de pantalla ni determina por sí sola la causa de la importación. Los originales se conservan separados. El diagnóstico mantiene las acciones, aserciones y 24 intentos, y añade capturas y consultas de sólo lectura antes de navegar. Estas observaciones añaden tiempo; un resultado posterior correcto no acredita que el fallo anterior fuera exclusivamente de entorno.

Evidencia: `.release.local/android-1.1.3-published-verification-1714.json`, `.release.local/android-1.1.3-apk-recheck-1714.json`, `.release.local/android-1.1.3-published-verification-37096554823.json` y `.release.local/native-import-diagnostic-38f0426-provenance.json`.

El observador añadió 1,143524 segundos: 0,343294 antes del intent y 0,800230 después de la primera captura. Esa primera captura ya mostró el PDF; Chrome pasó después a primer plano y se canceló con la recuperación que el helper ya tenía. El PNG de entrada muestra el lector sin hora ni iconos; el PNG de regreso conserva un encuadre transitorio. Los XML y volcados posteriores acreditan el estado final. La URL concreta del bundle no se observó dentro del emulador; la fuente y los bytes de la web se acreditan por la comprobación HTTP independiente.

La política nativa nueva requiere instalar [APK 1.1.3](https://miguelcoxcaballero.github.io/inhouse-read/download-android.html). La web y las voces se actualizan desde la publicación que carga el wrapper.

## Referencias

- [Arranque y buffer de voces naturales](natural-voice-startup-fix.md)
- [Pantalla durante la lectura](reading-display.md)
- [Frases entre páginas](speech-page-boundaries.md)
- [Verificación histórica de cambios de voz](voice-switch-verification.md)
