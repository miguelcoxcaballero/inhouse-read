# Reserva del framebuffer del libro — 1.7.76

## Cambio

Three cambia primero la anchura del canvas y después su altura. Cuando
ambas cambian, el navegador reserva un framebuffer con anchura nueva y
altura anterior, y acto seguido lo sustituye por el definitivo. El perfil
diagnóstico de 1.7.75 con SwiftShader/CDP registra 2.485,7 ms propios en el
setter interceptado de dimensiones, además de las muestras de setSize.
No son tiempos exclusivos sumables ni medidas de un teléfono.

La vista nativa del libro evita esa reserva completa intermedia con una
altura cero dentro de la operación síncrona de resize. La escritura normal
de Three deja exactamente el tamaño final y el viewport originales antes
de dibujar. Se mantienen DPR, resolución, geometría, texturas, materiales,
luces, sampler y relojes. No se cambia el tamaño del framebuffer final.

La optimización es opt-in para el libro. Las rutas legadas, XR, scissor,
targets externos, drivers desconocidos, cambios de un solo eje y accesores
instrumentados conservan el comportamiento anterior. Si se rechaza la
preparación se usa el resize original. Una operación interrumpida restaura
la altura anterior y retira los accesores temporales.

## Comprobaciones enfocadas

Pasan 55 pruebas en cinco archivos, incluidas nueve regresiones nuevas.
Verifican una sola reserva no vacía, dimensiones y viewport exactos,
redondeo físico, cambio de DPR, cambios de un eje, operación interrumpida,
operación parcial, orden inverso y rechazo del staging.

La comparación en Chromium/Three real produce píxeles RGBA idénticos en
ocho casos, con el modelo, materiales e iluminación reales: oro/plata,
cuatro encuadres, DPR 2/1,5 y libro cerrado/abierto/girado. Se comprueba
también que cada imagen contiene el modelo, que el contexto sigue activo
y que no hay errores GL. El helper no constituye un benchmark de velocidad.

Se conservan tres intentos diagnósticos fallidos: el primero carecía de base
URL para el bundle y los siguientes hicieron readPixels mientras el
exportador del entorno tenía un PIXEL_PACK buffer enlazado. El fallo
ocurría ya en el control anterior a la optimización. El helper corregido
desenlaza temporalmente ese buffer y lo restaura; mantiene el mismo modelo
y comparación exacta de píxeles. No cambia el código de la app.

Evidencia: `.animation.local/performance-1776/`. Batería completa,
animaciones originales y comprobación de publicación aún pendientes.
No se declara aprobación global ni FPS, batería o temperatura de un móvil.
