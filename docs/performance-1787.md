# Recursos del marcapáginas — 1.7.87 en preparación

Guardar progreso recreaba siempre la cinta, su material y su alphaMap,
incluso si el libro ya tenía marcapáginas. Ahora conserva la misma malla,
material, textura y buffers; actualiza geometría, color y metalness en el
lugar. Retiene el estado de apertura y retirada. Si desaparece el marcador,
libera sus recursos como antes; el primero sigue creando su malla original.
No cambia geometría, material, acabado ni duración de las animaciones.

No elimina la primera creación detectada en las pruebas nativas de1.7.85/86,
que empiezan con progreso0 y ningún marcador. No se atribuye a este cambio
una solución demostrada de esas aperturas frías ni del rendimiento móvil.
El alcance es evitar asignaciones repetidas al actualizar un marcador existente.

Seis nuevas y100 pruebas relacionadas PASS. Comparan geometría y material
con una cinta nueva en cuatro niveles de detalle, incluyendo apertura,
retirada, acabado al terminar, vuelta a lectura, eliminación y dispose.
La batería final completa está en marcha; comparación realRGBA y publicación
pendientes. No se alteran plazos, fuentes, fixtures o asserts de las pruebas
originales. Evidencia: `.animation.local/performance-1787/`.

La fuente final655 pasa3448 unitarias/276 archivos, build y75 Python.
Los524 listados son sólo censo, no ejecución. Dieciocho pares WebGL2 de
cintas ya subidas aGPU y actualizadas a progresos.3/.77/1 coinciden píxel
por píxel con modelos nuevos del progreso objetivo. Incluye tres acabados
y poses cerrada/abierta con retirada parcial, mismas dimensiones yDPR.
No mideFPS ni velocidad de un teléfono. Evidencia:
`full-local-resource2-attempt1/` y `bookmark-reuse-pixels-attempt1/`.

Los14 recorridos originales locales PASS, cero retries y deadlines intactos.
Los dos cierres nativos tardan4915/4819ms en esa tanda; no comparación causal
entre versiones ni prueba de velocidad móvil. Fuentes, build y métodos655
sin cambios durante las tres tandas (7principales+5catálogo+2regresiones).
Evidencia: `local-browser-attempt1/`, `catalog-browser-attempt1/` y
`return-regressions-attempt1/` de performance-1787.

SwiftShader adicional original: alineado PASS26924ms; fraccionario FAIL26692ms
por cierre a8s (body is-closing-reader), primer intento sin retries. El FAIL
permanece registrado y no acredita una regresión causal del material ni una
resolución del cierre frío: la propuesta sólo evita recrear un marcador ya
existente y ese fixture empieza sin marcador. No se declara toda la lentitud
resuelta. Evidencia: `swiftshader-original-attempt1/` de performance-1787.
Publicación de la mejora verificada14 recorridos normales y18 paresRGBA;
verificación pública y CI completa pendientes.
