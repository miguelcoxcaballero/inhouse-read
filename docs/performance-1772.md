# Reutilización del tono de página — Inhouse Read 1.7.72

## Cambio

Los snapshots físicos de PDF siguen copiando exactamente sus píxeles y
actualizando su encuadre. Mientras pertenecen al mismo raster completado,
dimensiones y filtro, comparten dos tokens opacos separados: página del
lector y papel original. El modelo conserva con esos tokens únicamente
el color del margen ya medido; evita volver a sincronizar la GPU mediante
getImageData al cerrar la misma página. No conserva otra copia del bitmap,
ni cambia texturas, resolución, iluminación, materiales o relojes.

Navegar, volver a renderizar, cambiar zoom, tema, brillo, dimensiones o
cerrar invalida los tokens. La vista adaptable mantiene el muestreo
original por fuente; las páginas de fotos conservan su decisión original
de no identificar un margen como papel. No se simplifica el algoritmo.

## Comprobaciones

Pasan 117 unitarias enfocadas, incluidas 13 nuevas sobre los tokens,
invalidaciones, colores exactos, copia fresca y fallback. El primer comando
enfocado conserva un fallo del nuevo fixture DOM por faltar getClientRects
en jsdom; corregida sólo esa geometría de prueba, pasan todos. Los tests
existentes, fixtures y plazos permanecen iguales. La batería CPU completa
pasa: 3.265 unitarias/254 archivos, build y 75 Python; fuente estable.
El listado de 524 E2E es sólo un censo. Pasan al primer intento los siete
recorridos gráficos originales sin retries ni omisiones, con fuente y
build estables. Cierres nativos completos: 5.721,2/4.738,0 ms, dentro del
plazo original de 8 s; no es una comparación controlada de velocidad.
Texturas, materiales y recursos originales se conservan.

Publicada desde `1c7242e`, Pages `7c41ab0`: main real de 1.462.542 bytes,
SHA256 `8db9dd79c048bbcfd0682861b6b8cf9fcbfc606aacdf2288bce161b46c059a70`.
HTTP26/offline90, APK descargado de 78.515.243 bytes y loader exacto de
2.089 bytes PASS. Pasan los tres recorridos públicos de editor/nativo y
los 18 PDF públicos al primer intento, sin retries u omisiones. Los
cuerpos HTTP corresponden al artefacto real, sin sustituir respuestas.
El lector PDF y encoder publicados generan JPEG 800×1600 sin conexión,
recibiendo sus módulos desde el service worker, sin fallback.

CI72 `37302341505` termina FAILED y se sella con los 12 logs, 11 ZIP
originales y 524 identidades/526 intentos. Pasan 3.265 unitarias y los
otros cinco grupos UI, voces reales y Supertonic. UI3 y el agregado fallan.
Las trazas originales mantienen esperas de apertura de 8 s; el segundo
intento fraccional llega a cerrar pero agota el presupuesto total original.
Certificado de originales `518cab6cf0093f65bfc5422d0fdb653add1320960c765fd4ba3ca7b304856e32`.
No se reintenta ni se reclasifica este run; no se infiere fluidez física.

Evidencia: `.animation.local/performance-1772/`.
