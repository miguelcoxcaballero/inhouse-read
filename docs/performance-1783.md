# Reserva compacta entre fases de animación — 1.7.83

## Cambio en comprobación

Apertura y cierre nativos conservan el mayor framebuffer compacto que haya
necesitado la secuencia. No se encoge entre bisagra, marcapáginas y zoom;
sólo crece si el modelo requiere espacio adicional. Mantiene el recorte
real, proyección, DPR, iluminación, materiales y relojes. Las reservas
anidadas y su liberación son idempotentes y se liberan en finally al terminar,
cancelar o fallar. Reservar y liberar no dibuja ni redimensiona.

Fuera de la secuencia se conserva el tamaño adaptativo habitual. El tamaño
retenido puede ser mayor que el recorte de una fase posterior, con el mismo
límite original del viewport. No hay mediciones nuevas de FPS, temperatura,
consumo o ejecución en un teléfono físico.

## Evidencia

El perfil de 1.7.82 atribuye unos 2,9 s a escrituras del tamaño del canvas,
2,2 s durante el cierre. Es un diagnóstico SwiftShader con sobrecarga de
perfilado, no un benchmark ni una causa de todos los retrasos de apertura.
Originales: `.animation.local/performance-1782/swiftshader-startup-profile-attempt1/`.

Propuesta compacta: siete unitarias nuevas y cuatro originales PASS. La
comparación WebGL2 real de 18 pares (tres acabados/seis poses) conserva todos
los bytes RGBA entre el recorte original y un recorte mayor retenido. Exige
contenido no vacío, poses distintas, contexto real activo y cambios físicos
del framebuffer. Cada captura obtiene de nuevo el contexto 2D para materializar
la instantánea. Método/fuente exactos en
`.animation.local/performance-1783-compact/motion-frame-pixels-attempt1/`.

Batería CPU revisada PASS: 3.424 unitarias/272 archivos, build y 75 Python.
Las 649 entradas de runtime/tests/config permanecen exactas. Siete gráficos originales, cinco de catálogo y dos regresiones adicionales
PASS sin retries. Cierres nativos de 4.744,4 y 4.936,2 ms en el renderer
local habitual, dentro de sus 8 s originales; no son un benchmark de teléfono
ni una comparación causal de velocidad. Comprobación adicional SwiftShader: alineado PASS (7.196,9 ms de cierre),
fraccionario FAIL por seguir cerrando tras 8 s. Son dos casos originales,
sin profiler, cambios de plazo ni retries; el fallo sigue pendiente.
Publicación en curso, sin aprobación global de rendimiento. El censo
de 524 identidades E2E no sustituye su ejecución completa en CI.

## Propuesta anterior descartada

La primera propuesta reservaba todo el viewport. Se conservan su código,
pruebas e informes en `.animation.local/performance-1783/`; no se publicó.
Pasaron 3.424 unitarias/272 archivos, build/75 Python, siete gráficos y dos
regresiones adicionales en el renderer local habitual. Catálogo: 4 PASS/1 FAIL
por primer frame de tres luces al recargar nogal en el plazo original de 8 s,
un contrato que también falló en CI 1.7.82. Software SwiftShader: 0 PASS/2 FAIL
al cerrar; el caso fraccional terminó en 8.023,9 ms y el alineado no llegó
a completar la devolución dentro de 8 s. Esos fallos siguen siendo fallos.
Su comparación anterior de 18 imágenes exactas no acredita rapidez.

El primer fixture nuevo esperaba 320 px donde el recorte original real mide
256 px; sólo se corrigió el fixture nuevo. Los informes y código anteriores
se conservaron. Ninguna prueba original, fixture ni plazo se ha relajado.
El primer diagnóstico de lámparas no ejecutó casos porque faltaba una copia
de book-length.js en su espejo; se conserva como fallo del método, no del producto.


El diagnóstico CPU de luces sobre la propuesta compacta pasó el caso original
sin ampliar tiempos. Conserva su sobrecarga y alcance diagnóstico; no demuestra
que el fallo anterior esté corregido. Perfil y fuente fijados en
`.animation.local/performance-1783/lamp-first-frame-profile-attempt2/`.
