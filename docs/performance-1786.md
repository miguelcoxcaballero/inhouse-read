# Preparación de composición de sala — 1.7.86

## Cambio en preparación

El compositor nativo enlazaba su shader al prepararse, pero Three reflejaba
sus uniforms al primer replay de la sala durante el regreso del libro.
Ahora se enlaza y refleja en intervalos libres después de la primera pintura.
Los shaders, capas, texturas, tamaños, luces y tiempos de animación permanecen
idénticos. No se captura ni dibuja el framebuffer durante la preparación.
Se cancela por dispose, cambio de generación, contexto perdido o propietario
inactivo; una excepción conserva el camino de dibujo normal del compositor.

Una observación del caso original de regreso fraccionario de 1.7.85 identifica
39 uniforms de un MeshPhysicalMaterial con alphaMap del marcapáginas y 14 del
RawShaderMaterial de composición consultados durante `inserting`.
Las consultas de fuentes se hicieron después del cuerpo original; el wrapper
conserva sus valores. El caso pasa con los límites originales de 30/8 segundos.
Esto identifica programas y fases, no acredita una mejora de velocidad ni
elimina el coste restante del marcapáginas.
Evidencia: `.animation.local/performance-1785/insertion-shader-observer-attempt1/`.

## Verificación

Seis nuevas pruebas y 31 enfocadas PASS. La primera batería con finales de
línea normalizados pasa 3.442 unitarias/275 archivos, build y 75 Python.
Se conserva completa. La fuente final restaura los finales de línea originales
en el archivo de la estantería para limitar el diff a las dos líneas nuevas;
la segunda batería final también pasa3.442/275, build y75 Python, con654
hechos de fuente exactos. Los 524 casos listados son un censo,
no ejecución gráfica. Ningún test, fixture, aserción o deadline original cambia.
No se declara publicación, aprobación de CI ni rendimiento en un teléfono.

Tres pares de composición WebGL2 con una, dos y tres capas conservan cada
byte RGBA. No se afirma rendimiento de la aplicación a partir de ese ensayo.
Evidencia: `room-uniform-pixels-attempt1/` de performance-1786.
Los siete recorridos originales principales y cinco de catálogo PASS,
sin retries ni modificaciones de fixtures, plazos o aserciones. Los cierres
nativos tardan5.009/5.005ms en esta tanda local; no comparación causal con
otra versión ni teléfono. Evidencia: `local-browser-attempt1/` y
`catalog-browser-attempt1/` de performance-1786.

Los dos cierres originales adicionales con SwiftShader PASS en su primer
intento (26,2/26,7s totales, límites30/8 intactos). El caso original de planta
vecina también PASS con SwiftShader, sin retry. Su primer comando quedó en
cero tests por un grep anclado al inicio del título completo; se conserva
como fallo de harness no ejecutado. El segundo filtro conserva el cuerpo,
fixture y plazos originales. Total17 recorridos gráficos locales PASS.
Evidencia: `swiftshader-original-attempt1/` y
`plant-neighbor-original-attempt2/` de performance-1786; intento1 conservado.
La publicación y su verificación real siguen pendientes.

El observador de la fuente final pasa su cuerpo original y encuentra39
uniforms del material físico del marcapáginas durante inserting; ya no
encuentra los14 del compositor en esa fase. Los shaders consultados después
del cuerpo y sus métodos654 quedan fijados. No acredita eliminar el coste
restante ni una mejora causal de FPS o velocidad del teléfono.
Evidencia: `insertion-shader-observer-attempt1/` de performance-1786.
