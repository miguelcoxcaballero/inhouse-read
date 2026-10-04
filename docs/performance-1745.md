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

## Resultado publicado de 1.7.45

Fuente `95a5c0f598b9eafaaad6dc0281ee0eee9ab53063`, Pages
`8580c5b95ca87e43210eb3a0ab92efacf15350df`. El entry público
`main-DZ8-l5F1.js` tiene 1.423.753 bytes y SHA
`a5d64d7afc226a4e9d905cc2e4f4eec8a875f111bbfb6f4c80245c56654da6d1`.
Coinciden los 23 módulos y los 44 recursos offline con el artefacto publicado.
Los 18 casos PDF públicos pasan sin reintentos, con 310 cuerpos HTTP
contrastados y 15 capturas. La APK descargada sigue siendo 1.1.4/código 17,
78.515.243 bytes, SHA
`feafaaa762b35344ac8b19418f9f6eb6cb1f725fba22b1ef3d3f273bd32a6191`;
su loader exacto tiene 2.089 bytes y no incorpora una copia de la web.

Pasan 2.711 unitarias en 182 archivos. En tres perfiles gráficos, 42
comparaciones RGBA y 21 pares de PNG del canvas nativo son idénticos;
no hay reducción de resolución, materiales o geometría. La prueba original
de portada de escritorio pasa localmente conservando sus ocho segundos.

La [CI original 37205632278](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/37205632278)
permanece **FAILED**: 522 casos únicos, 523 intentos, un fallo original y un
reintento aprobado en la regeneración de una miniatura PDF antigua.
Se conservan los doce logs y once ZIP autenticados; certificado
`c1fa43d388fa33232132701b1ee884bced02841361d5b17bc989edb1cfbaaaeb`.
La traza muestra la animación de selección todavía incompleta al agotar
los ocho segundos. No se cambia su plazo ni se acredita con el reintento.

El perfil pesado de la web pública registra **10.095,1 ms**, por encima de
su presupuesto original de ocho segundos. Las 28 copias del cierre suman
2.607,5 ms: 1.675,3 ms corresponden a la inserción y 870,6 ms a la imagen
final de la estantería. Incluyen esperas de GPU. El renderer observado es
ANGLE/SwiftShader; no representa un teléfono físico ni acredita temperatura
o FPS en Android. La siguiente optimización parte de este fallo conservado.
