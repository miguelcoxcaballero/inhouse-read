# Fuentes y rendimiento de Inhouse Read 1.7.68

Las siete familias y sus 93 caras CSS conservan los mismos pesos, estilos,
rangos Unicode y archivos WOFF2 originales de Google Fonts. Los 34 archivos
suman 759.412 bytes y ahora se sirven desde la propia app, con sus siete
licencias OFL. Se elimina la dependencia externa de tipografía y se incluye
todo en el shell offline. El título del lomo Playfair se precarga desde el
mismo asset utilizado por CSS; los dos preloads de madera permanecen.

No cambia la geometría, iluminación, texturas 3D, DPR o relojes. El payload
offline aumenta: no se afirma memoria neutra ni FPS o temperatura medidos
en un teléfono físico. Tampoco se atribuye toda la demora de una traza a
la red: la recepción de una fuente puede retrasarse por el hilo principal.

Pasan las siete comprobaciones enfocadas de fuentes/preloads, build e
inventario real: 34 cuerpos exactos, 93 caras, preload reutilizado y 89
entradas offline. La batería completa pasa 3.213 unitarias/252 archivos, build y 75 Python.
En Chromium real cargan las 93 caras online y offline; raster y medidas
coinciden. Los 34 cuerpos se vuelven a pedir explícitamente sin red y se
sirven desde el Service Worker con SHA256 exacto. El preload se solicita
una sola vez antes de esas comprobaciones adicionales. Los siete recorridos
de animación pasan al primer intento con sus fixtures y plazos originales,
sin retries ni omisiones; los 611 hechos de fuente/build permanecen estables.
Publicada desde `7cff7fc`, Pages `2bd9ed0`: HTTP25/offline89 y APK/loader
reales comprobados. Pasan los 18 PDF públicos y las fuentes reales online y
offline (93 caras, 34 cuerpos exactos y raster idéntico). El verificador
suplementario de fuentes conserva dos fallos de espera: una Promise se
interpretaba como true antes de resolver la instalación del Service Worker.
Su reparación espera la condición resuelta dentro del mismo plazo; el
runtime y las pruebas originales no cambian.

Los tres recorridos públicos conservan editor y alineado PASS y el
fraccional FAILED por el global30. No se reintenta ni se usa su diagnóstico
pasivo posterior como aprobación del original. Ese diagnóstico completa el
cierre en 5.759 ms; no es una medición aislada de FPS. CI68 conserva fallos
en UI2/UI3; los demás grupos completados pasan y Supertonic sigue en curso.
No se presenta como batería completa aprobada.

Evidencia: `.animation.local/performance-1768/`.
