# Codificación de portadas PDF — Inhouse Read 1.7.71

## Cambio

La portada conserva su raster, dimensiones y JPEG .9. Cuando el navegador
admite Worker, OffscreenCanvas y createImageBitmap, se transfiere el bitmap
a un worker que realiza la lectura y codificación, liberando el hilo de
interfaz. Cancelar termina el worker y descarta el resultado; cada petición
posee sus recursos y los libera. Los navegadores antiguos o los fallos de
worker conservan el encoder original, sin iniciar otro tras una cancelación.

## Comprobaciones

Pasan 43 unitarias enfocadas, incluidas las 17 del protocolo, fallback,
transferencia y cancelación nuevos. Chromium real ejecuta el módulo y el
worker reales: cuatro portadas, de 300×200 a 1200×1600, incluyendo una con
transparencia, producen exactamente los mismos bytes JPEG que toBlob .9,
sin fallback y con dimensiones idénticas. El experimento y sus procesos
quedan cerrados. No es una medida de FPS ni de consumo térmico de un móvil.
La batería CPU completa pasa al primer intento: 3.252 unitarias en 254
archivos, build y 75 comprobaciones Python de Android. El censo de 524
casos e2e es una enumeración, no una ejecución. Fuente y compilación se
mantienen estables durante la calificación. Pasan los siete recorridos
gráficos originales al primer intento, sin retries ni omisiones; cierres
nativos completos de 4.830,6 y 5.482,3 ms dentro del plazo original de 8 s.
Se conservan las seis texturas de lomo de 1024 y los recursos del modelo.
Publicada desde `8929226`, Pages `6c68dfc`: main real de 1.462.461 bytes,
SHA256 `f3e1986bbc36f0c4964a6f0395780d971ca0f1183913e4a877b9e6e531cea97b`.
HTTP26/offline90, APK descargado y loader exacto PASS. Pasan al primer
intento los tres recorridos públicos nativo/editor y los 18 PDF públicos:
fotos RGB en cinco temas, frases completas, orden, párrafos, navegación,
reapertura y correspondencia del texto narrado. Sus cuerpos HTTP se
comparan con el artefacto real, sin sustituir respuestas.

El lector PDF y su encoder reales funcionan sin conexión: el worker
publicado de 460 bytes se recibe desde el service worker y genera JPEG
800×1600 sin fallback. Una preparación inicial conserva su fallo de
selección (inspeccionó también los módulos antiguos retenidos); no ejecutó
navegador ni encoder. La selección posterior usa el grafo actual exacto.

El diagnóstico separado SwiftShader/CDP conserva alineado PASS y
fraccional FAILED al superar la espera original de 8 s del cierre; no
se reclasifica ni representa una medición de FPS del teléfono. CI71
`37299786543` sigue en curso, con UI3 ya fallido; no se afirma aprobación
completa. Su UI3 original conserva 40 casos/42 intentos, dos retries y
cuatro intentos fallidos en los dos contratos nativos (límite global30).
Los traces originales alcanzan el segundo clic y agotan la espera de
apertura del lector; se preserva el resultado, sin ampliar plazos.
El perfil identifica la codificación en el hilo separado del
worker (2.174,4 ms propios en el alineado), mientras el cierre fraccional
aún vuelve a muestrear el papel en el hilo principal (1.849,8 ms propios).
Son muestras diagnósticas separadas por PID/TID, sin sumar tiempos
inclusivos ni atribuir una mejora global medida en un móvil.

Evidencia: `.animation.local/performance-1771/`.
