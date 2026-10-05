# Preparación de shaders de apertura — 1.7.75

## Cambios

La precompilación de Three enlazaba programas, pero sus uniformes seguían
consultándose de forma síncrona al dibujar una cara por primera vez.
La página cubierta prepara los uniformes de los mismos programas en turnos
idle antes de mostrar «Listo para leer». Espera el enlace sin consultas
prematuras y cancela al cambiar de página, selección o cerrar. Un driver
incompatible conserva el dibujo original. No añade renders, texturas,
geometría ni modifica iluminación, resolución, DPR o relojes.

La estantería publica el contador real de programas al terminar la preparación
idle del indicador y la profundidad. Antes conservaba el recuento anterior
hasta el siguiente dibujo: un resize parecía crear programas aunque el
contador de linkProgram no cambiase. La regresión reproduce 7→11 programas
con la misma cantidad de renders.

## Verificación en preparación

98 pruebas enfocadas en cinco archivos PASS. Las seis pruebas nuevas de
uniformes cubren preparación una vez por programa, enlace pendiente,
cancelación, límite de espera, fallo de reflexión y renderers incompatibles.
La nueva prueba del contador reproduce el fallo anterior y pasa con la
corrección. No se declara todavía aprobación de la batería completa, web
publicada o APK para esta versión. Tampoco un porcentaje de mejora o FPS
de un teléfono físico. Evidencia: `.animation.local/performance-1775/`.

## Batería local antes de publicar

Pasan 3.360 unitarias/262 archivos, build y 75 Python. El listado completo
conserva 524 identidades E2E; el listado no se cuenta como ejecución.
Pasan los siete recorridos gráficos originales al primer intento, sin
retries: cierre alineado 4.771,8 ms y fraccional 5.349,1 ms. La resolución
de los seis libros observados permanece en 1024 y el gesto de cámara
conserva 20 frames de compositor sin renders GPU adicionales.

Pasa el caso original Monstera en walnut y baggebo: 20→20 y 19→19 programas,
sin enlaces nuevos y con los draw calls originales. Persisten tareas de
resize de 389/256/372 ms; no se afirma ausencia total de bloqueos ni un
porcentaje global de mejora. La publicación y CI completos se verificarán
independientemente. Los límites originales no se ampliaron.
