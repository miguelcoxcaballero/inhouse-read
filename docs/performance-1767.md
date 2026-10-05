# Rendimiento de Inhouse Read 1.7.67

## Cambio

La sala con dimensiones fraccionarias permanece en el canvas WebGL original.
Por ejemplo, conserva un framebuffer de 589 × 1174 a 393 × 783 CSS y DPR1,5.
Se eliminan las copias síncronas a Canvas2D en los repintados de esa ruta.
Los modelos, luces, texturas, resolución y relojes permanecen iguales.

Las capturas públicas conservan sus dimensiones originales de 590 × 1175
y se materializan bajo demanda. La inspección conserva su compositor CSS
y genera sus tiles al necesitarlos. El fallback por falta de soporte real,
la pérdida de contexto y la devolución del renderer a su propietario siguen
implementados. La presentación visible elimina una etapa de interpolación;
su igualdad gráfica real aún debe comprobarse. No se promete memoria neutra:
la ruta añade texturas de sala dentro del pool existente, sin elevar el DPR.

El E2E de 393 px migra explícitamente de la sala visible en 2D a la sala
WebGL real. Su fixture, gestos, plazo total de 30 s, cierre de ocho segundos
y comparación de capturas permanecen. El original RAW y sus fallos previos
se conservan en la evidencia.

## Comprobación en curso

Pasan 116 unitarias enfocadas: 101 originales y 15 nuevas, más el build.
El control con los dos módulos originales conserva 101 PASS y presenta
11 fallos causales en los 15 nuevos casos. Dos primeros intentos del
candidato quedan FAILED por el simulador nuevo: su compilador no devolvía
un iterable y su viewport seguía siendo el de jsdom. Sólo esos fixtures
nuevos se corrigen; el runtime y las pruebas originales no cambian.

Los siete recorridos gráficos pasan al primer intento, sin retries ni
omisiones, con 535 entradas fuente/build estables. Los cierres medidos
completos son 5.699,9 ms (alineado) y 5.226,4 ms (fraccional), dentro del
plazo original de ocho segundos. La ruta fraccional usa WebGL2 real,
conserva el nodo/contexto al insertar el libro y mantiene idéntica la
captura visible antes y después del export bajo demanda. Los gestos
reutilizan su imagen durante el movimiento y restituyen los seis libros
con resolución de texto 1.024. No hay reducción de calidad o resolución.

La batería completa, publicación, pruebas públicas y comprobación de la
APK están pendientes; los tiempos del navegador software no son FPS
medidos en un móvil físico.
Estos resultados no acreditan FPS, consumo o temperatura de un móvil físico.

Evidencia: `.animation.local/performance-1767/`.
