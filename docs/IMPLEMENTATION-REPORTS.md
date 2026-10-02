# Paquetes A–D: verificación y límites

## A — Controles con disposición estable

Se conserva la caja de controles visibles al entrar en foco: se ocultan los contenidos de cabecera y barra con visibility/opacity, sin eliminar sus márgenes. Se elimina la segunda altura de barra (64 px); reading.css mantiene los 48 px originales más safe-area. Los márgenes siguen recibiendo toques por zonas, también en RTL. La ocultación retira los controles de teclado, hit testing y árbol accesible inmediatamente; mostrarlos puede fundir 120 ms, sin movimiento reducido.

Medición en Chromium, 390 × 844, DPR 2: antes, visor 748 → 844 px y EPUB 20 → 22 líneas; después, visor 748 → 748 px, 20 → 20 líneas, iframe y número de páginas idénticos. Escritorio: 704 px y 26 líneas sin cambios. PDF normal/reflujo y horizontal mantienen cajas y dimensiones de canvas idénticas. Insets simulados por CDP: cabecera 72 px, barra 68 px, caja invariable incluso con panel abierto.

Validación: npm ci y build correctos; 1002/1002 unitarias, 62 archivos. De 26 e2e (controles, capturas, disposición y gestos), 24 pasan; la prueba adicional de safe-area/panel/accesibilidad pasa (1/1). Los dos fallos de gestos se reproducen sobre main b4dd143: PDF double-tap falla la posición izquierda del canvas tras arrastre (línea 42); EPUB tapping the side edges falla el retorno por toque izquierdo (línea 108). No se han debilitado: quedan fuera de este cambio. Se actualizan las aserciones antiguas de reader-layout: la barra conserva su caja, por lo que ahora se exige que sus botones desaparezcan y la caja del visor sea exactamente igual, en vez de exigir que crezca. Las dos regresiones nuevas de EPUB/PDF fallaron sobre el código antiguo antes de implementarlo.

Capturas revisadas: márgenes del tema papel y nocturno en móvil; generadas también en sepia y escritorio. No comprobado: hardware Android/iOS real, lector de pantalla real ni archivo MOBI; este comparte la ruta Foliate, pero no se ejecutó un MOBI. Safe-area es simulación de Chromium. No se afirma rendimiento de 120 Hz en hardware.
