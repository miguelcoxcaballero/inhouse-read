# Rendimiento — Inhouse Read 1.7.17

Fuente de la aplicación: `64a91da1ff688d9bd0d3fe9d8e511fbf2d8548ca`. Publicación: [Inhouse Read](https://miguelcoxcaballero.github.io/inhouse-read/).

## Cambios

- El PDF abre directamente en la página guardada con las preferencias de lectura. Reutiliza la página y su capa seleccionable únicamente cuando siguen válidos el documento, página, tamaño, DPR, preferencias y contenido. Redimensionar, cambiar de modo o cancelar invalida la preparación correspondiente.
- La estantería conserva el trabajo pendiente mientras está oculta detrás del lector. Una escena limpia ya no se vuelve a pintar al consultar la posición de devolución. Las animaciones activas mantienen sus fases y sus relojes.
- Ampliar y alejar las plantas cambia sus mapas de detalle preparados, conservando las mallas, materiales y geometrías. Se mantienen las mismas resoluciones, filtros y reflejos; las preparaciones canceladas se liberan.
- El marcapáginas reutiliza sus buffers durante la animación, conservando las posiciones, normales, UV e índices de cada pose original.
- Las extracciones de portada pertenecen a su sesión de lectura; un resultado antiguo no puede reemplazar la portada de otro libro o bloquear una reapertura.

## Comparación con 1.7.16

Misma escena: seis libros, tres plantas y una lámpara, Chromium/SwiftShader en Windows, viewport 390 × 844, DPR 1. Dos ciclos de apertura y cierre por versión y un ciclo de inspección por versión. Los originales se conservan en `.animation.local/performance-1717/`.

| Trabajo observado | 1.7.16 | 1.7.17 |
| --- | ---: | ---: |
| Llamadas 3D al redimensionar con el lector abierto | 508 en cada ciclo | 0 en ambos |
| Nuevas cargas de buffers al abrir | 107 / 115 | 23 / 23 |
| Nuevas cargas de buffers al cerrar | 264 / 260 | 81 / 81 |
| Modelos reconstruidos al ampliar y volver | 18 | 12; se evitan las seis reconstrucciones de plantas |
| Geometrías de la escena | 89 | 89 |
| Texturas durante la inspección | 54 | 54 |

El primer fotograma de cierre pasó de 6,28 / 6,17 s a 1,88 / 2,04 s; el cierre completo, de 12,65 / 12,20 s a 7,77 / 8,06 s. Son observaciones de un renderizador por software, con lecturas de diagnóstico y una ejecución breve de pruebas durante parte de la tanda inicial. No equivalen a tiempos, FPS, temperatura ni batería de un teléfono.

La estantería estática, la inspección y su restauración conservan los mismos píxeles. Las unidades comparan geometrías y mapas de ocho plantas, además de nueve poses del marcapáginas registradas antes del cambio. Se mantienen modelos, polígonos, iluminación, sombras, texturas y DPR. Permanecen las fases de zoom, marcapáginas, cierre, vuelo e inserción.

El observador inicial de la segunda cámara aceptó el reposo anterior antes del primer RAF de la transición. Su captura intermedia se excluye de la comparación estática, conservando sus datos. Un suplemento espera los cuatro endpoints reales y vuelve a comparar la imagen final: diferencia cero. Un primer selector ambiguo del suplemento y la expectativa inicial de ancho de la prueba nueva también se conservan como fallos del observador. La prueba final usa el ancho real del lector, incluido el espacio del scrollbar; conserva el requisito de cero repintados ocultos. No cambió el runtime para esas correcciones.

## Comprobaciones

- [Batería completa 37113842421](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/37113842421): **2.141/2.141 unitarias en 127 archivos y 331/331 E2E**, sin omisiones, reintentos, flaky ni errores globales. Sus 12 jobs y 11 ZIP originales pertenecen a la fuente `64a91da1ff688d9bd0d3fe9d8e511fbf2d8548ca`; el censo E2E comprende 202 casos UI y 129 con motores de voz reales.
- Revisión nueva de las voces: cuatro ZIP, 193 miembros y 106 WAV comprobados. Certificado semántico: `.animation.local/ci-37113842421/neural-semantic-review.json`, SHA-256 `3bee113279668aa003946bb693f3430cbf9fe6000803a93e270c20aa2aa899a5`.
- **20/20 casos originales sobre la web publicada**: nueve de página preparada PDF/EPUB, cinco de apertura PDF, uno de compatibilidad con APIs antiguas, uno de continuación PDF con PCM real, tres de recursos/catálogo/retorno y uno de movimiento isométrico. Conservan sus aserciones, gestos y plazos originales, con cero reintentos, omisiones o errores. La continuidad audible mantiene los píxeles anteriores durante 146 observaciones y muestra la continuación al comenzar su audio real.
- Los cuatro casos de escena conservan el canvas y los recursos del catálogo; los 20 fotogramas observados del gesto usan composición sin repintados WebGL, y los seis libros recuperan sus mapas de 1.024 px. El nuevo caso de redimensionado conserva el número de frames y renders mientras el lector está visible.
- Certificado CI: `.animation.local/ci-37113842421/aggregate.json`, SHA-256 `e49a788f5653e7dba311c6251ba58475f01a591e88f6da530f70e456647311d7`. Lectores públicos: `.animation.local/final-live-evidence/reader1717/certification.json`, SHA-256 `f2834768d4ea9a05a28ad9c8c843624e2d4cc053017284c641835bf7e9299153`. Escena pública: `.animation.local/final-live-evidence/scene1717/certification.json`, SHA-256 `49b1195d77ab15ebd06ef5c373e1b31b82bd1ac42ccb6d856037c8aaffd62ef1`.

La ejecución local de 2.141 unidades corresponde al árbol de trabajo congelado antes del commit. Su observación de archivos conserva la fuente base `9550e9a` y la única corrección posterior de un observador E2E; no se renombra como ejecución local del commit. La ejecución de CI sí usa directamente `64a91da`. Los datos anteriores/focales y los errores iniciales de observación se conservan separados de los resultados finales.

## Artefactos publicados

Pages: `ae809d710a76a00eda4aa69a5f65276dd93e6915`. Entrada `main-BL7jM-hN.js`: 1.393.092 bytes, SHA-256 `6b57f1f76396164c811fc36300579e7f0662463992b69bade74f0943126207a9`. Se contrastaron por HTTP los 20 módulos y estilos, y los 40 archivos del shell offline: 21.447.731 bytes. Certificado combinado: `.animation.local/final-live-evidence/artifact-1717-64a91da.json`.

La APK pública sigue siendo 1.1.3, código 16. La descarga nueva conserva 3.174.689 bytes y SHA-256 `67a52bdebff36c889c81061c488d002f4ac881404e9d1a5f6ad49e909ce267f7`; su loader extraído mide 2.089 bytes y no contiene una copia de la app. Esta actualización de JavaScript llega a la APK a través de la web. No se hizo un APK nuevo ni una nueva prueba física de Android.
