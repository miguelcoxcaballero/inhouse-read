# Animaciones y rendimiento de Inhouse Read 1.7.70

## Cambio

La apertura y el regreso reservan el mayor encuadre compacto de cada fase
antes de animar. Se calculan 17 poses sólo con la geometría, sin dibujar ni
leer píxeles. Cada frame real conserva el sampler y reloj originales,
DPR, materiales, luces y modelos. Si la geometría cambia durante la fase,
el encuadre puede crecer; nunca se reduce la resolución ni se recorta el libro.
La reserva se libera al terminar, cancelar o desechar la vista. Se conserva
el tamaño completo de los exports y la política de fallback.

## Motivo

La traza diagnóstica de 1.7.69, en Chromium con SwiftShader forzado y CDP,
conserva dos timeouts originales de 30 s. El setter de dimensiones del canvas
acumula 6.549/5.790 ms de muestras propias durante las animaciones del libro.
Su cadena pasa por setSize, configureNativeRendererSize, configureFrame,
draw y el tick de animateMotion. No son medidas de un móvil ni tiempos
exclusivos sumables con los eventos solapados de CPU/GPU. El diagnóstico
no sustituye la prueba pública normal ni la ejecución original de CI.

## Comprobaciones

Las 79 pruebas enfocadas pasan, incluidas tres regresiones nuevas: reserva
estable sin renders de preparación, poses originales, exports exactos,
liberación al cancelar y crecimiento con cambios de geometría. La batería
local completa pasa: 3.235 unitarias/253 archivos, build y 75 Python.
El listado de 524 E2E es un censo sin ejecución. Pasan los siete recorridos
gráficos al primer intento, sin retries, omisiones ni flaky, con fuente y
build estables. Los cierres completos nativos observados son 5.555,7 y
5.339,2 ms; ambos quedan dentro de los 8 s originales. No constituyen una
comparación controlada de velocidad frente a la versión anterior.
Publicada desde `4ed1f8e`, Pages `0873080`: main real de 1.462.461 bytes,
SHA256 `7bd77ee5aa635ed0af929e6be5e98c0f9e998a04a94f0e1e17388219037d1dfc`.
HTTP25/offline89 y APK/loader descargados PASS. La lectura inicial antes de
terminar Pages conserva un pin fallido por HTML anterior; la nueva lectura
tras completarse Pages coincide exactamente. No hubo ejecución de navegador
ni reintento de pruebas en esa lectura de disponibilidad.
Pasan los tres recorridos públicos nativo/editor y los 18 PDF, al primer
intento, sin retries ni omisiones. Cada caso observa el main real y los
cuerpos HTTP se comparan con el artefacto, sin sustituir respuestas.

El diagnóstico separado SwiftShader/CDP conserva alineado FAILED global30
y fraccional PASS. Las muestras propias del setter bajan de 6.549/5.790 ms
a 1.879/1.723 ms en esos recorridos; siguen quedando llamadas de codificación
JPEG y lectura del tono de la página costosas. Son observaciones diagnósticas,
no FPS de un teléfono ni aprobación de CI. CI70 `37297764955` sigue en curso.
Las aserciones y plazos originales de las pruebas existentes se conservan.

Evidencia: `.animation.local/performance-1770/`; diagnóstico original y
resultados completos anteriores conservados en `performance-1769/`.
