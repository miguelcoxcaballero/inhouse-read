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

Pasan 3.382 unitarias/264 archivos, build y 75 Python. Los siete
recorridos gráficos originales pasan al primer intento, sin retries.
Los cierres nativos tardan 5.538 y 5.692,3 ms en este navegador local.

Publicado `ff14970` en Pages `a517783`: HTTP32/offline96 PASS, main
`main-BUveZJon.js`, SHA256
`2d976a659dba6bcba3d4961dfc6165921f96c2eb16580de1c5f01b19d86b591e`.
APK descargado: 78.515.243 bytes, SHA256
`feafaaa762b35344ac8b19418f9f6eb6cb1f725fba22b1ef3d3f273bd32a6191`;
loader de 2.089 bytes idéntico a Git, sin app obsoleta dentro.
La primera comprobación del índice conservó FAIL mientras Pages aún servía
la publicación anterior. La segunda comprobó los bytes de la versión nueva.
Los 21 recorridos públicos originales pasan sin retries: tres de editor/
retorno nativo y 18 de PDF adaptable. Auditorías HTTP PASS (99 y 593 cuerpos
de la app); papel PDF offline en cinco temas y portada PDF/JPEG offline
sin fallback PASS. CI global sigue en curso.

Evidencia: `.animation.local/performance-1776/`.
No se declara aprobación global ni FPS, batería o temperatura de un móvil.
