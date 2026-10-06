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
Web1.7.98 publicada desde a6ff7a222a77b72e47efb77dd6f12896717c85e3;
Pages0c11e707e27b87c55e4d6aa7f218950c3283d08b. HTTP32/shell96 PASS.
Diez recorridos locales originales PASS (siete principales, dos regresos
SwiftShader y el gesto), sin retries. Web real:27/27 estrictos PASS:
cuatro regreso/editor/gesto,18 PDF y cinco catalogo/plantas/luces.
La primera preparacion del espejo fallo antes de ejecutar el navegador
por una suposicion sobre goto; se conserva, sin contar como test.
Tres comprobaciones offline PASS: bytes/posicion/fotos sin Drive,
colores originales en cinco temas y portada800x1600 con el worker real.
CI original37544390548 completa:FAIL.11 artefactos originales autentificados,
censo526/528 intentos, dos retries y cuatro fallos en los dos regresos nativos
del shard3; otros cinco shards y las cuatro familias de voces PASS. No se
modifican las esperas originales30s/8s ni se cuentan retries como PASS.
Android1.1.7/código20 ya descargado y verificado independientemente.
