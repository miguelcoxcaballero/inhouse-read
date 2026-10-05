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

## Integración de cambios publicados en paralelo

El push de `ed11a2b` fue rechazado porque `origin/main` había avanzado a
`06f0f5e`. Se integra mediante merge, conservando los cambios nuevos de
arranque por tareas idle, menús diferidos, chunk separado de Three.js y
recuperación acotada de imports. Las tres modificaciones E2E de origen
se conservan explícitamente: gesto para audio y distinción de peticiones
canceladas durante recarga en dos comprobaciones de assets.
Las pruebas nativas originales de apertura/cierre no cambian.

La primera batería y sus siete PASS acreditan la fuente anterior a este
merge. La fuente combinada requiere una batería y recorridos nuevos;
no se reetiquetan los anteriores. Namespace independiente:
`.animation.local/performance-1773-integrated/`.

La primera batería integrada conserva exit 1: 3.296 assertions pasaron,
pero hubo dos errores sin capturar de idle-startup tras destruirse el
contexto. El polling ahora termina si su documento ha desaparecido y las
tareas vuelven a comprobar la propiedad después de esperar idle. El
update Android utiliza el mismo scheduler. No se ocultan los errores ni
se modifican fixtures originales. El nuevo namespace de calificación es
`.animation.local/performance-1773-integrated-final/`; pasan las pruebas
focales del arranque y los dos escenarios que emitían esos errores.

La batería corregida integrada pasa: 3.303 unitarias/257 archivos con
exit 0 y sin errores sin capturar, build y 75 Python; 626 hechos de fuente
estables. El listado conserva 524 identidades sin ejecutarlas. Se inicia
una nueva ejecución de los siete contratos gráficos originales sobre
esa fuente combinada, manteniendo sus assertions y plazos.

## Origen nativo después de ocultar el encabezado

Los siete recorridos integrados conservan 6 PASS y un fallo de precondición:
el nuevo origen top=61 no cae en píxeles físicos a DPR 1,5. La sala de
390×784 sigue teniendo el framebuffer correcto de 585×1176. La estantería
integral se coloca en el origen CSS representable más cercano (62 en ese
caso); se mueven juntos el escenario y sus controles. No cambia tamaño,
DPR, modelos, texturas o iluminación. La sala fraccional de 393 px mantiene
su camino anterior. La posición original se restaura al destruir la escena.

Pasan 9 unitarias del cálculo y ambos contratos gráficos nativos originales
al primer intento sobre esta corrección, sin cambiar sus fixtures, assertions
o plazos. Es una ejecución focal, no sustituye el recorrido previo fallido.
La batería final y los siete recorridos usarán el namespace independiente
`.animation.local/performance-1773-origin/`.
