# Continuación: crecimiento del lienzo 3D del libro

## Candidato 1.7.113

Al crecer ambos ejes del framebuffer, la asignación intermedia cabe ya dentro
de la asignación final necesaria. El libro seleccionado usa la misma política
`bounded` que la sala: evita pasar por altura cero en ese caso. Si un eje crece
y el otro se reduce, mantiene la asignación vacía para evitar un pico mayor.
Se conservan dimensiones, DPR, viewport, modelos, materiales y relojes.

Diagnóstico aislado con sustitución sólo durante el build:
`.animation.local/performance-1813/resize-probe-summary.json`. Cinco poses
reales conservan exactamente su RGBA, dimensiones y viewport; errores GL cero.
Los reinicios nativos pasan de13 a11. Esto prueba menor trabajo de asignación
en esa muestra; no prueba menor duración global ni FPS o calor de un teléfono.

83 focales PASS, incluidos tres nuevos casos que ejecutan el cuerpo real de
configureFrame. Dos originales SwiftShader PASS sin retries, 24,2/25,1 s,
con límites de30 s globales y8 s de cierre. No hay comparación de velocidad
con control pareado y esas cifras no acreditan una aceleración.

Batería completa, publicación y comprobaciones113 pendientes. La112 pública
mantiene su evidencia independiente en [su informe](performance-1813.md).
