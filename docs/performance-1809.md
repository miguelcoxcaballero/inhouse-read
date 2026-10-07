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
fuente aún están pendientes al preparar este documento.
La CI anterior 108 (`37621752197`, fuente `98a62cd`) conserva ambos
recorridos nativos FAIL en su primer intento y retry; sus originales
autenticados se descargaron y se comprobaron contra los digests de GitHub.
Sus 3.612 unitarias pasan. Ningún PASS local sustituye esos fallos.

No se afirma que toda la lentitud esté resuelta. No se han medido FPS,
temperatura o batería de un teléfono físico. No se añadieron voces en este
cambio: siguen 39 Piper y diez personas Supertonic en 22 idiomas; los 220
perfiles de idioma no son 220 personas distintas.
