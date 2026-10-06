# Reserva por fases al cerrar —1.7.91 en comprobación

Al terminar el zoom de la página se libera su reserva de framebuffer.
Marcapáginas, bisagra y vuelo mantienen sus reservas por movimiento y la
misma proyección, DPR, materiales y relojes. Liberar no dibuja ni redimensiona;
el siguiente frame realiza su ajuste habitual. Finally sigue liberando en
cancelación/error previos al zoom; se evita repetir la liberación después.
La apertura y las devoluciones sin snapshot conservan su ciclo original.

Seis regresiones nuevas y25 relacionadas PASS. El control conserva los bytes
exactos de1.7.90: dos casos nuevos fallan por retener la reserva durante las
fases siguientes y cuatro pasan. No sustituye una medición de GPU/FPS real.
Batería, comparación RGBA y recorridos gráficos/publicación pendientes.
Evidencia: .animation.local/performance-1791/before-control/.

## Calificacion local

3474 unitarias en280 archivos, build y75 Python PASS;660 hechos fuente
estables. Los524 casos listados son un censo, no ejecuciones E2E.
18 pares WebGL2 con cinta visible, mate/oro/plata y diversas poses
conservan RGBA exactos al liberar la reserva y ajustar el frame.
Siete recorridos originales locales PASS, cero retries y plazos30s/8s
intactos. Cierres5113.8ms y5332.8ms; no demuestra una ganancia causal
de FPS ni velocidad en un telefono. Publicacion y auditorias pendientes.
Evidencia: full-local-resource2-attempt1/,phase-release-pixels-attempt1/
y local-browser-attempt1/.
