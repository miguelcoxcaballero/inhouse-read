# Fluidez en 1.7.45

La selección también utiliza las ventanas de cámara alineadas a píxeles.
El libro cerrado tiene una ventana fija más pequeña; al abrir la portada
dispone del ancho de las dos hojas. La página ampliada, los DPR fraccionarios
y cualquier pose que no cabe conservan el buffer original. El canvas de
exportación mantiene su tamaño completo. No cambian resolución, materiales,
texturas, modelos, iluminación ni relojes.

Los reemplazos con su portada ya decodificada se incorporan antes del dibujo
de layout. El layout consume además el RAF que esa actualización había
programado. La decodificación pendiente conserva su ruta asíncrona, sus
errores y su protección contra reemplazos cancelados. Los relieves siguen
preparándose de forma independiente.

## Diagnóstico conservado de 1.7.44

La publicación 80319a5 pasa 2.701 unitarias locales, 33 casos de animación y
18 PDF públicos, sin reintentos. Mantiene 28 comparaciones RGBA exactas y
14 pares de capturas nativas idénticos. Sus módulos públicos y el APK real
están contrastados. Esto no aprueba su CI completa: la ejecución original
37203231542 conserva sus fallos.

Las trazas originales muestran el marcapáginas real mientras el muestreo de
500 ms se salta una fase de 360 ms; la narración tiene 36 comienzos audibles
correctos y una petición adicional todavía sin comenzar. Sus observadores
ahora esperan mediante RAF. Se mantienen todas las aserciones originales,
todas las peticiones y un único plazo de ocho segundos para observar el
marcapáginas. No se ralentiza ni se detiene la app para aprobar una prueba.

El caso de portada de escritorio seguía animándose al agotar su plazo: es
un fallo real de rendimiento. El perfil público pesado de seis libros
registra 10.881,4 ms y sigue fallando su presupuesto original de ocho
segundos. Estos fallos no se convierten en aprobaciones por sus reintentos.

El perfil aislado identifica una actualización legítima de la portada PDF:
su proporción pasa de 2/3 a 1,5; el modelo cambia de 97,864 × 146,796 a
143 × 95,333, conservando el grosor de 14,43. La nueva imagen ya estaba
decodificada, pero el microtask esperaba 921 ms al dibujo del modelo viejo.
Esta espera ocurre después del reloj de cierre y su eliminación no acredita
por sí sola el presupuesto del cierre.

Las pruebas y mediciones de 1.7.45 se conservan separadas de estos originales.
Su verificación completa y publicación se registran al terminar.
