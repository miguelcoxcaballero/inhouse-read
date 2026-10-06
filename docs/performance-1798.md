# Web 1.7.98: pestaña y encabezado comparten el mismo control

La traza original con SwiftShader de 1.7.97 registra un gesto que cambia
Portada a Lomo y termina en 90 grados. El encabezado estaba recortado a
1px y coincidía con otra pestaña. La espera de regreso a cero agotaba
2.200ms; no se interpreta como una medida de velocidad de la GPU.

El encabezado semántico envuelve ahora la pestaña activa visible. Se usa
el mismo botón, texto, estilo, id y eventos. No hay otra fila ni texto
duplicado; se conservan el orden y el foco de teclado al cambiar pestaña.
La interrupción sigue usando240ms. No cambian renderer, materiales,
geometría, texturas, maxStep ni límites de las pruebas originales.

Pasan49 comprobaciones enfocadas (tres nuevas y46 del editor existente).
Batería local completa:3.508/3.508 unitarias en287 archivos, build y
92 Python PASS. Censo526 sin skips; el listado no ejecuta los navegadores.
El caso original del gesto con SwiftShader PASS, cero retries y límite
original2.200ms. Se conserva el fallo1.7.97; este resultado pertenece al
código corregido. Los datos antes/después protegen runtime/config/tests.
Web real y CI completa de1.7.98: pendientes.
Android1.1.7/código20 ya descargado y verificado independientemente.
