# Continuación: crecimiento del lienzo 3D del libro

## Cambio publicado 1.7.113

Al crecer ambos ejes del framebuffer, la asignación intermedia cabe ya dentro
de la asignación final necesaria. El libro seleccionado usa la misma política
`bounded` que la sala: evita pasar por altura cero en ese caso. Si un eje crece
y el otro se reduce, mantiene la asignación vacía para evitar un pico mayor.
Se conservan dimensiones, DPR, viewport, modelos, materiales y relojes.

Diagnóstico aislado con sustitución sólo durante el build:
`.animation.local/performance-1813/resize-probe-summary.json`. Cinco poses
reales conservan exactamente su RGBA, dimensiones y viewport; errores GL cero.
Los reinicios nativos pasan de 13 a 11. Esto prueba menor trabajo de asignación
en esa muestra; no prueba menor duración global ni FPS o calor de un teléfono.

83 focales PASS, incluidos tres nuevos casos que ejecutan el cuerpo real de
configureFrame. Dos originales SwiftShader PASS sin retries, 24,2/25,1 s,
con límites de30 s globales y8 s de cierre. No hay comparación de velocidad
con control pareado y esas cifras no acreditan una aceleración.

## Publicación y comprobaciones113

Fuente `c52169680895e89fe7970570dc2a4d546332e91c`; Pages
`b2e0a5fcee4ca249073b8e4bf5a4c885deda384a`. El índice real (14.894 B) y
`assets/main-Bfc9eWuv.js` (614.584 B) coinciden con sus hashes fijados.
El grafo HTTP32 y shell96 coinciden con la publicación. Evidencia ignorada:
`.animation.local/performance-1814/`.

Batería local: 3.645 unitarias/296 archivos, build y 105 Python PASS.
Los siete originales locales pasan al primer intento, sin alterar sus
fixtures, expectativas ni plazos. Los699 archivos de producto y pruebas
guardados mantienen exactamente sus bytes durante la comprobación pública.

Web publicada:32 casos,30 auditorías estrictas PASS y dos FAIL. Los dos
fallos ocurren en public-http-fixture.mjs:32 al recibir capturas HTTP200/0 B
de las texturas de nogal; las aserciones de producto terminaron antes.
No se convierten esos resultados en PASS ni se reejecutan para borrarlos.
Rendimiento5/5, catálogo5/5 y compatibilidad Android4/4 PASS. Cuatro
comprobaciones offline PASS: bytes y progreso, fotos, portada y cierre.
El pipeline agregado conserva estado failed por esos dos fallos.

Diagnóstico independiente de los cuerpos de nogal: nueve cargas reales,
sin sustituir respuestas de la app. Los blobs que consume el producto
conservan tamaños y hashes completos; el decoder recibe1024×1024 píxeles.
No reproduce las capturas vacías (cero en nueve cargas) y, por tanto, no
explica ni invalida los dos fallos anteriores. Se conserva su método y
summary en veneer-body-diagnostic-attempt1.

APK público1.1.8/code21: descarga nueva, tamaño78.531.695 B, hash, firma y
loader de2.107 B PASS; web113 no exige otro binario. Run de emulador
`37998436603` SUCCESS, ZIP original8.482.515 B autenticado. Cinco estados
nativos PASS para barras, insets y pantalla activa. Preflight Google aceptado;
no acredita una cuenta humana autenticada ni FPS, calor, batería o audio
prolongado en un teléfono físico.

CI113 original `37997890352` terminada con FAIL. Las cuatro familias de
voces con pesos reales pasan. Su shard3 conserva los dos
regresos nativos timedOut tanto en primer intento como en retry, con los
límites originales30 s globales/8 s de cierre. Las mejoras de asignación
no resuelven todavía el rendimiento completo. La112 pública mantiene su
evidencia independiente en [su informe](performance-1813.md).

Recogida final autenticada en ci-original-attempt1/snapshot-001: once ZIP y
doce jobs, sin incidencias de colección;3.645 unitarias/296 archivos y533
E2E únicos.531 PASS, dos FAIL nativos;535 intentos, dos retries y cuatro
intentos fallidos. Los demás shards y las cuatro familias de voces PASS.
No se vuelve a ejecutar el run original ni se sustituyen sus fallos.

Las cuatro trazas originales están leídas en ci-native-timelines.json.
Desde goto hasta Back transcurren26,58/26,79 s para390×845 y24,41/25,03 s
para393×844, según primer intento/retry. Dejan menos de los8 s de cierre
dentro del presupuesto global de30 s. No prueban que todo el retraso sea
del cierre, ni que éste cumpla8 s: hay que reducir y medir por fases la
preparación y las transiciones completas, conservando los plazos actuales.

## Investigación adicional de voces

No hay voces nuevas en113. Marko del repositorio phantom9623 ya está en
el catálogo y no se cuenta de nuevo. Los modelos chinos adicionales
[Chaowen](https://huggingface.co/rhasspy/piper-voices/blob/main/zh/zh_CN/chaowen/medium/zh_CN-chaowen-medium.onnx.json)
y [Xiao Ya](https://huggingface.co/rhasspy/piper-voices/raw/main/zh/zh_CN/xiao_ya/medium/zh_CN-xiao_ya-medium.onnx.json)
usan fonemas pinyin, que los clientes actuales no generan. La
[ficha de Xiao Ya](https://huggingface.co/rhasspy/piper-voices/blob/main/zh/zh_CN/xiao_ya/medium/MODEL_CARD)
declara dependencia de g2pW en Python Piper1.4+ y datos de uso no comercial;
la [ficha de Chaowen](https://huggingface.co/rhasspy/piper-voices/blob/main/zh/zh_CN/chaowen/medium/MODEL_CARD)
declara datos CC0 y ajuste a partir de Xiao Ya. No se presentan como voces
compatibles verificadas: no se han descargado ni sintetizado sus pesos.
Su integración exigiría un frontend pinyin en web y Android y validación
con audio real. Permanecen39 opciones Piper y diez personas Supertonic,
con220 perfiles lingüísticos; los perfiles no son personas adicionales.
