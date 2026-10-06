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

Publicación fuente78927c79c63d73f67b6011ee677cc5cf202a6568, deploy
37422423728 PASS; Pagesf7f3bd88eefa733176cbc8e2faae6b834651968a.
Main real `assets/main-DiqhcQos.js`,593062bytes,SHA256
`e3b16bbd44eb55ff97bc3a7950ea898c14a5abf1003af89a9c70f72de8825982`.
El primer pin conserva FAIL porque el HTML servido aún refería al main85;
el segundo pin coincide exactamente. HTTP32/offline96 PASS, certificado
SHA256`611df6f70f6738816e32df5cef882330419c87171e3b9b75d692ded78b170bb2`.
Nueva descarga APK1.1.4/code17 PASS,78515243bytes,SHA256
`feafaaa762b35344ac8b19418f9f6eb6cb1f725fba22b1ef3d3f273bd32a6191`.
Loader real2089bytes exactos, sóloindex/cordova/cordova_plugins; no bundle
antiguo ni nueva ejecución en teléfono. CI86 completa en marcha; unitarias PASS.
Los recorridos públicos y offline están pendientes.
Evidencia: `.animation.local/performance-1786/public-78927c7-attempt2/`.

Los26 recorridos públicos y auditorías PASS, cero retries. Papel offline
v4 y v5 PASS en cinco temas, con píxeles normal/settled idénticos; portada
offline JPEG800x1600/150310bytes PASS, cero fallback. Caché real
`inhouse-read-shell-v1-49684dab01962e39c9c6b94dbe13d41e791d52495cda381723e8f80478b002ea`.
Reader real `pdf-reader-_lexx0qk.js`,26432bytes,SHA256
`a691cbba84e5dcd244c189623e3c8a9bc43ced8d27f8b2d2dc417810f992f135`.
La CI86 sigue en marcha; no se declara aprobación global ni rendimiento móvil.

Snapshot001 de CI86 conserva7ZIP/7jobs completos,182 identidades/185
intentos/3 retries/5 fallos; todavía no es censo completo524. SóloUI3 FAILED
en esa recogida: luz1 tras recarga falla a8s y pasa retry (flaky rechazado),
alineado falla antes de mostrar PDF y su retry llega al cierre pero vence
el plazo global30; fraccionario falla mostrando PDF en ambos intentos.
UI4 yUI5, unitarias y tres tandas Piper PASS. Supertonic y otrasUI pendientes.
No se sustituyen los fallos ni se atribuye causalmente a86 el paso deUI4.
Evidencia: `ci-original-37422423840-attempt1/snapshot-001/`.

CI86 completa FAILED: 11ZIP/12logs,524 identidades/527 intentos,
3 retries/5 intentos fallidos; sin omisiones ni errores de recogida. Unitarias
3442/275, las cuatro tandas de voces yUI1/2/4/5/6 PASS. SóloUI3 falla los
originales descritos arriba; un retry aprobado de luz1 sigue rechazado como
flaky. No se declara todo el rendimiento resuelto. Evidencia:
`ci-original-37422423840-attempt1/snapshot-002/`.
