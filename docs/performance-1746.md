# Rendimiento de 1.7.46

## Cambios

La estantería y la inserción comparten su renderer existente. El canvas nativo
permanece visible y sus imágenes resueltas se conservan en texturas de la GPU;
las copias hacia canvas 2D se realizan sólo cuando un consumidor pide una
captura. El traspaso al final conserva el mismo canvas y limpia el marcador de
retorno antes de pintar el hueco ocupado. La selección y el cierre calculan un
encuadre acolchado desde las mallas visibles, sin reservar píxeles para páginas
ocultas o el marcapáginas retirado. No cambia el DPR, la geometría, los materiales,
las sombras, las texturas ni los relojes de las animaciones.

El zoom y el desplazamiento de la vista isométrica conservan la composición CSS
original. El compositor GL de las primeras candidatas cambia el muestreo de
algunos bordes; sus comparaciones PNG fallidas no se cuentan como aprobadas.
Conservar imágenes en la GPU usa memoria adicional: no se presenta como un
cambio de memoria neutral. Las texturas temporales se liberan al cancelar o
terminar la inserción; las de la escena se liberan con ésta y al perder el contexto.

## Resultados anteriores conservados

La web 1.7.45 tarda 10.095,1 ms en el perfil pesado original y falla su plazo de
ocho segundos. El primer cierre nativo medido tarda 9.020,2 ms y también falla;
elimina las 28 copias GPU a 2D del cierre, pero quedan dos fotogramas de
presentación que suman otros 2.235,1 ms. Ninguno acredita fluidez en un móvil.

Las candidatas gráficas V3/V4 conservan sus fallos estrictos de PNG: 27 imágenes
RGBA de origen coinciden, pero las imágenes compuestas del zoom difieren hasta
16/24 niveles RGB. La candidata V5 añade el encuadre de mallas visibles y pasa
2.752 unitarias sin fallos ni omisiones. Su resultado es independiente de la
candidata final con composición CSS durante el zoom.

La verificación de la fuente final, el perfil real y la publicación se añaden
después de ejecutarlos. Los plazos y las aserciones originales permanecen intactos.

## Comprobaciones de la candidata

V6 mantiene la composición CSS original durante el zoom. Las 42 comparaciones
estáticas y sus 21 PNG coinciden en los tres perfiles comprobados. Las cinco
poses adicionales con una página PDF real también coinciden. El primer montaje
de esa prueba no contenía correctamente el canvas nativo: su fallo se conserva
y el montaje corregido tiene un resultado separado.

La inserción dinámica conserva 27 imágenes RGBA de origen y las imágenes del
zoom, reposo y estado final. Su comparación estricta de PNG sigue fallando en
26 capturas por diferencias de un nivel RGB en bordes; el alfa coincide y no hay
componentes que difieran más de un nivel. Ese resultado no se cuenta como PASS.

El reloj pesado V6 tarda 9.012,6 ms y sigue fallando el plazo de ocho segundos.
El encuadre realmente se reduce, pero no acorta ese caso frente a V3. La
presentación posterior de dos fotogramas tarda otros 2.252,0 ms. La medición usa
SwiftShader y no demuestra tiempos, temperatura ni fluidez en un teléfono.

V7 conserva el fondo 2D original cuando sus dimensiones físicas son
fraccionarias y presenta únicamente el libro animado sobre él con WebGL. El
fondo permanece visible durante la inserción y se libera el libro después de
las guardas de pintura, inmediatamente antes del repintado final. El primer
resultado unitario de esta candidata es 2.757/2.757 en 193 archivos, sin
omisiones; el build pasa. Las pruebas de navegador y la fuente adoptada se
documentan por separado.

Un registro idéntico ya no cancela y reconstruye un modelo cuya portada sigue
cargando. Se compara la geometría, la calidad y todas las claves de material.
Los cambios reales siguen preparando otro modelo; el progreso del marcapáginas
se aplica directamente. Al resolver o fallar la portada se reconcilian los
datos recientes, sin recuperar una candidata cancelada u obsoleta.

## Contratos de navegador de la candidata V7

Pasan el caso original de miniaturas PDF y el retorno móvil de 393 × 844 a DPR
2,75. Este último conserva el fondo 2D visible, presenta el libro nativo en
cinco poses y completa el cierre en 5.885,1 ms. La captura exportada no cambia
la imagen visible y al terminar no quedan overlays.

El primer contrato nuevo de 390 × 844 conserva FAILED. Pedía una habitación
nativa aunque su altura inicial era 783 px: a DPR 1,5 son 1.174,5 px físicos y
la guarda de alineación exige el fondo 2D original. La inserción sí conservó
su canvas y contexto en las cinco poses; el cierre tardó 5.818,1 ms. El fallo
no se transforma en PASS.

Una fixture nueva de 390 × 845 garantiza antes de seleccionar el libro una
habitación nativa de 390 × 784, con 585 × 1.176 píxeles físicos. Pasa en su
primera ejecución, conserva las aserciones originales de ocho segundos,
contexto, profundidad y exportación PNG, completa el cierre en 5.120,8 ms y
acredita el traspaso del mismo
canvas a la estantería. La fixture fallida permanece fuera de la suite adoptada;
se incorpora la fixture cuya precondición está comprobada. No hay una matriz
PNG completa nueva para el perfil 393: sus materiales y el renderer del libro
mantienen la fuente comprobada en V6 y sus comprobaciones nuevas tienen el
alcance funcional descrito.

## Fuente adoptada

La fuente 1.7.46 incorpora la candidata V7, la corrección de modelos pendientes
y las dos fixtures ejecutadas: nativa alineada de 390 × 845 y fondo legado de
393 × 844. Los 291 archivos de pruebas existentes se conservan byte por byte;
no se cambian aserciones ni plazos anteriores. Pasan los cinco casos nuevos de
reemplazo y la batería completa de 2.762 unitarias en 194 archivos, en su primera
ejecución, sin fallos ni omisiones. Pasan también el build y las 75 comprobaciones
Python originales. El censo con fixtures reales y la misma configuración de
evidencia de CI contiene 524 casos de navegador requeridos, sin omisiones; es
un listado, no 524 pruebas ejecutadas. Los listados previos sin esa configuración
se conservan separados. La ejecución completa de CI y las verificaciones de la
publicación tienen resultados posteriores al push.
