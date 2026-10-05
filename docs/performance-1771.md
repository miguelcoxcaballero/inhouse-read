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
El despliegue y su comprobación pública siguen pendientes a esta escritura.

Evidencia: `.animation.local/performance-1771/`.
