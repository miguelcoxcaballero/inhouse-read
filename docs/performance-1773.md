# Muestreo de papel fuera de la interfaz — Inhouse Read 1.7.73

## Cambio

La medición inicial del margen de la página 3D pasa a un worker mediante
ImageBitmap. Se conserva el raster completo, el muestreo de 12×12,
el anillo de 44 píxeles, el umbral alfa y los cuartiles originales.
El modelo recibe los mismos valores RGB en sRGB o la misma decisión null.
Sólo se guarda esa medición bajo los tokens del raster completado.

El worker libera sus bitmaps y el canvas auxiliar al terminar. El cliente
lo termina también al cancelar, cerrar o fallar. Las capturas concurrentes
del mismo raster comparten una tarea; una navegación o un cambio de brillo
durante la espera vuelve a capturar la página actual. WebViews sin esas
APIs o con un worker bloqueado conservan el sampler original.

No cambia resolución, DPR, textura, geometría, luz, material o reloj de
animación. El primer muestreo aún necesita completarse: trasladarlo al
worker evita bloquear el hilo principal, no acredita por sí solo FPS ni
una apertura más rápida en cualquier dispositivo.

## Comprobaciones en preparación

Pasan 143 unitarias enfocadas, con 27 casos nuevos sobre el algoritmo,
protocolo, recursos, cancelación y cambios de página durante la espera.
Ocho raster reales en Chromium, entre 300×200 y 1200×1600, conservan
exactamente los colores del sampler original y las decisiones null,
con ocho workers reales y cero getImageData en el hilo principal.
El primer comando de integración conserva un fallo de memoria causado
por índices de dimensión equivocados en la nueva validación. Se corrige
el runtime; las pruebas originales y sus plazos permanecen iguales.

La batería CPU completa pasa: 3.292 unitarias/255 archivos, build y
75 pruebas Python, con 620 hechos de fuente estables. Las 524 identidades
del listado E2E son sólo censo, no ejecución. Pasan los siete recorridos gráficos originales al primer intento, sin
retries, omisiones ni flaky y con fuente/build estables. Cierres completos
de 5.179,6/5.217,9 ms dentro de los 8 s originales. Se mantienen seis
lomos de 1024 px y 74 geometrías/52 texturas/34 programas en el gesto
isométrico, con cero frames GPU durante ese movimiento. La publicación
con comprobaciones web/APK sigue pendiente. No se afirma PASS global.

Evidencia local: `.animation.local/performance-1773/`.
