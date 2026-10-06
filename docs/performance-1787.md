# Recursos del marcapáginas — 1.7.87 publicada

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

Publicación fuente8477f7af9603296439843c86eff0495bb5ac9592; deploy
37425792392 PASS. Pagesdc8cb9b32623289f495a8489289d724b8ad48ca5.
Main real `assets/main-QIkKPb2C.js`,593120bytes,SHA256
`e94e211c3f0899ec87ce47e9d17d2f08efe11b204ead74f6f74506f10934cb61`.
Pin en primer intento, HTTP32/offline96 y nueva descargaAPK/loader2089bytes
PASS. Certificado de HTTP
`1033b6c6a46f46a445eafb69960c12d5892b60c16e5adff6dbc4e28b834868d9`.
Los tres recorridos públicos principales y auditoría PASS; PDF18, catálogo,
offline y CI completa todavía pendientes. Evidencia:
`.animation.local/performance-1787/public-8477f7a-attempt1/`.

La captura adicional de texturas registra seis creaciones durante insertar,
pero la textura512x768 y la composición786x1688 se reutilizan en los17 copies;
no se identifica recreación por frame ni se prepara una reserva mayor de
texturas sin esa evidencia. El cuerpo original instrumentado pasa, pero
no sustituye el FAIL del SwiftShader original. No es comparación causal
ni prueba de FPS móvil. Evidencia: `insertion-texture-observer-attempt1/`.

Verificación pública final: PDF18, catálogo5, principales3 y sus auditorías
PASS, cero retries. Papel normal y settled en cinco temas, y portadaJPEG
offline PASS; lector real26432bytes y worker desde el SW. Los26 públicos
pasan. CI37425792376 sigue en marcha: snapshot001 recoge9ZIP,266 casos/
270 intentos,4 retries y6 fallos enUI1/3/6. Originales conservados; no
resolución completa ni prueba de rendimiento móvil. El observador adicional
de dimensiones confirma que los cambios589x1174↔786x1688 ya pasan por
el staging de altura0, sin recreación de buffers por frame observada.
No se introduce un cambio de sizing sin evidencia.

CI final37425792376 FAILED: onceZIP, doce logs,524 casos únicos y528
intentos;4 retries/6 intentos fallidos. Unitarias3448/276 y las cuatro
tandas reales de voces PASS. UI2/4/5 PASS; UI1 EPUB paginado al reanudar
no recupera el highlight en un intento, UI3 dos aperturas nativas (una
repetición llega a cierre pero agota30s) y UI6 salida de pipeta fallan.
Los retries aprobados siguen siendo flaky y se rechazan. No se sustituye
esta ejecución completa por26 recorridos públicos ni se declara terminado.
Evidencia: ci-original-37425792376-attempt1/snapshot-002/.
