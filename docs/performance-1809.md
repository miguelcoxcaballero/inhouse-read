# Web 1.7.109: preparación gráfica durante el reposo

## Cambio

Una estantería que ya ha presentado su imagen prepara los programas del
renderer de selección a partir de un libro visible. Se usan sus materiales
y la iluminación real del libro seleccionado. No se mueve el modelo, no se
suben texturas ni se dibuja una imagen adicional. Las reflexiones de uniforms
se reparten en momentos de reposo; una selección, movimiento o descarte
del modelo cancela la preparación. La caché conserva su límite anterior.

La preparación es opcional. Un error del driver conserva la compilación
normal al seleccionar un libro. No cambian geometrías, luces, resolución,
animaciones ni los límites originales de las pruebas.

## Evidencia inicial

- 45/45 pruebas focales pasan. Se añaden ocho regresiones; los originales
  conservan su prefijo exacto. El primer harness nuevo no dibujaba su modelo
  antes de consultarlo: sus seis fallos se conservan y se corrigió sólo ese
  harness.
- Los dos recorridos nativos originales pasan en el control 108 y en el
  candidato, sin retries, con límites 30 s/8 s intactos. Sus duraciones
  totales son 19.235/19.725 ms y 19.153/19.138 ms respectivamente. Esta
  muestra no prueba una mejora sostenida de la fluidez ni del cierre.
- Instrumentación separada después de 1,5 s de reposo: la selección enlaza
  12 programas en el control y 5 en el candidato. El tramo instrumentado
  dura 4.417,5/3.876,2 ms e incluye una captura previa a la selección; no
  es un tiempo aislado de selección. El candidato enlaza diez programas en reposo; tres son
  variantes adicionales del modelo de estantería. Las consultas JS rápidas
  al driver no miden por sí solas el coste GPU.
- Capturas de la sala iguales byte por byte: PNG SHA-256
  `07b5bd5707048282e10f6f74717b94314a3f9865b0a043314591c68d20a13b9a`.
- APK público 1.1.8/code21 descargado de nuevo: 78.531.695 bytes, SHA-256
  `5d10e6555c5c05e59925d18d5e0c959a08d8e41761a5aad37832c9d40d8e7eb1`.
  Firma v2 válida, certificado esperado y loader de 2.107 bytes idéntico a
  su fuente Android `98a62cd91dbb6e4ed9bf63d814be700711534350`.
  No contiene una copia empaquetada de la web. Este cambio es web.

Los originales están en `.animation.local/performance-1809/`; la APK en
`.animation.local/performance-1796/apk-1.1.8-performance1809-attempt1/`.
Se conserva también el primer error de ruta del harness de comparación,
antes de que ejecutase ningún navegador.

## Verificación local completa

3.620 unitarias en 293 archivos, build y 105 pruebas Python pasan.
Los siete recorridos locales originales y los dos SwiftShader pasan sin
reintentos; se conservan los límites 30 s/8 s de los regresos nativos.
La publicación HTTP, los recorridos sobre la web real y la CI de esta
fuente ya se han contrastado; los resultados completos están abajo.
La CI anterior 108 (`37621752197`, fuente `98a62cd`) conserva ambos
recorridos nativos FAIL en su primer intento y retry; sus originales
autenticados se descargaron y se comprobaron contra los digests de GitHub.
Sus 3.612 unitarias pasan. Ningún PASS local sustituye esos fallos.

No se afirma que toda la lentitud esté resuelta. No se han medido FPS,
temperatura o batería de un teléfono físico. No se añadieron voces en este
cambio: siguen 39 Piper y diez personas Supertonic en 22 idiomas; los 220
perfiles de idioma no son 220 personas distintas.

## Publicación y comprobaciones completas

- Web 1.7.109 publicada desde
  `3f2591521aa975b6f432a1990f5f10f235c2296b`.
  Pages: `279bc58ae811db34e6444c0f2a5638ed0a587949`.
- Main público: `assets/main-BwPzOK5Y.js`, 612.978 bytes, SHA-256
  `906b64b8381f490014b0f8a8964ab26347d03688a6c819a13b99706af96ae320`.
  Los 32 recursos del grafo y las 96 entradas offline coinciden por HTTP
  con los blobs de la revisión Pages. El primer intento observó aún 108;
  se conserva y la comprobación definitiva corresponde a 109.
- CI `37689554099`: **531/533 casos de interfaz pasan**. Los dos regresos
  nativos 390/393 px agotan el plazo en el intento original y el retry:
  535 intentos, dos retries y cuatro intentos fallidos. Las 3.620 unitarias
  de 293 archivos pasan. Ningún resultado local sustituye estos fallos.
- Se descargaron los once ZIP originales de CI y los doce logs de jobs.
  Todos los digests coinciden con GitHub, el censo contiene las 533
  identidades únicas y la fuente de cada artefacto coincide con la publicada.
  Una segunda auditoría de esos originales conserva los cuatro timeouts.
- Web real: **30/32 auditorías estrictas pasan**. En el editor y en el PDF
  escaneado pasan las aserciones funcionales, pero la captura del auditor
  registra HTTP 200 con 0 B para walnut-surface; el editor también registra
  0 B para walnut-pbr. Las trazas originales conservan esos resultados y
  no hay requestFailures. No se atribuye su causa a una cancelación ni se
  declara toda la tanda aprobada.
- Las 18 comprobaciones PDF cubren fotografías con RGB original en papel,
  sepia, noche, AMOLED y salvia, orden del texto, narración de todas las
  frases, navegación y reapertura. Cinco casos comprueban catálogo,
  plantas, escala, luces y acabado; cuatro comprueban el puente Android.
  Ese puente web no equivale a un teléfono físico.
- Cuatro recorridos offline pasan: bytes/progreso local, imágenes en cinco
  temas, portada JPEG y portada retenida al cerrar inmediatamente. La
  importación offline conserva sus 3.143 bytes y el progreso tras recargar;
  `driveFileId` permanece null. La subida a Drive sigue siendo opcional.
- Las cuatro familias de voces reales pasan en CI. Supertonic completa los
  220 perfiles offline con sus pesos reales. No se añaden personas nuevas
  ni se presenta una variante de velocidad como otra voz.

## APK público y políticas del lector

El APK 1.1.8/code21 arriba identificado se ha comprobado también en una
ejecución nueva de `verify-published-android.yml`, run `37690088577`, fuente
`3f25915`. Se descargó el APK público, no un build local. La firma, loader
y preflight de Google pasan; no aparece `redirect_uri_mismatch`.
Esto no prueba una sesión humana autenticada de Google Drive.

Los cinco estados originales del emulador pasan: estantería antes/después,
lector, lector reanudado y aplicación en segundo plano. La barra de estado
se muestra en la estantería y se oculta en el lector. El lector mantiene la
pantalla encendida y libera ese bloqueo en segundo plano. Los límites del
WebView permanecen `[0,0,1080,2214]`; la cabecera de estantería queda por
debajo de la barra de estado. Se conservan imágenes, XML y dumps originales.
No se afirma una prueba nueva de autonomía, calor o audio prolongado en un
teléfono físico. Este cambio web no requiere otro APK.

## Experimentos posteriores descartados

Preparar todos los uniforms antes del primer dibujo del libro seleccionado
añadió espera. La comparación separada con SwiftShader y trace:on, mismos
originales y límites, dio 23.551/22.777 ms para 109 y 26.644/25.020 ms para
el candidato con tareas de 0 ms. La variante con idle de 50 ms tampoco
demostró una mejora sostenida. Ambos experimentos quedan en
`.animation.local/performance-1810/` y **no se publican**.

Se restauraron byte por byte el runtime y la prueba unitaria experimental;
los 695 archivos de entrada coinciden con la batería completa de 109.
Se reconstruyó 109 para retirar el candidato del dist local.

Una comparación separada con/sin service worker ofrece tiempos similares
(23.291/23.401 ms frente a 23.390/23.563 ms). No demuestra que la caché
offline cause la demora y no justifica modificarla.

## Trabajo pendiente y evidencia

El rendimiento del recorrido nativo continúa abierto. Las trazas de CI
llegan a Back entre 25,3 y 27,1 s; el plazo global de 30 s corta la
comprobación de cierre. No es una medición independiente de ocho segundos
de cierre completado. Las capturas de textura de 0 B también conservan FAIL.
No se considera toda la optimización terminada.

Evidencia en `.animation.local/performance-1809/`:

- `ci-original-attempt1/snapshot-003/`: censo completo y auditoría de los
  once ZIP originales, incluidos los timeouts y retries.
- `public-3f25915-attempt2/`, `browser-batch-summary.json`,
  `failed-original-trace-textures.json`: HTTP, recorridos y fallos originales.
- `native-public-attempt1/`: APK, políticas originales del emulador,
  digests del ZIP y log, y `policy-audit.json`.
- `sw-isolation-attempt1/`: diagnóstico independiente de la caché.

Los originales, aserciones y plazos de las pruebas permanecen intactos.
