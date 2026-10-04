# Rendimiento de web 1.7.47

## Alcance de los cambios

La fuente conserva geometría, materiales, resolución de las imágenes, DPR y
relojes de animación. Los cambios eliminan trabajo repetido y liberan recursos
que ya no tienen consumidores; todavía no se ha medido una mejora de FPS ni
de temperatura en un teléfono físico.

- **Lecturas de la biblioteca:** una cola agrupa los avisos de fondo durante
  80 ms y permite una sola lectura activa. Los avisos recibidos durante esa
  lectura forman un lote posterior, con su propia promesa. Un pedido inmediato
  adelanta el lote pendiente sin solapar lecturas. Se conservan los errores,
  el arranque inmediato y la restauración desde BFCache.
- **Guardar una edición:** un libro cuya cubierta ya está preparada reutiliza
  el modelo actual. Conserva los recursos de páginas, tapas y cinta; actualiza
  el lomo y vuelve a pintar la cubierta si cambian sus datos. Las cubiertas
  todavía pendientes o fallidas conservan su reemplazo y reintento anteriores.
- **Memoria de la habitación:** se liberan sólo los slots administrados que no
  están referenciados por la imagen presentada ni por una exportación pendiente.
  Un frame liberado o reemplazado deja de ser válido. Esta poda no solicita una
  captura 2D y no libera la textura que necesita el propietario actual.
- **Inserción y gestos:** el canvas nativo pertenece al host del libro hasta su
  entrega a la estantería. Sus datos describen el frame realmente presentado.
  Al pasar a los mosaicos CSS originales se libera primero el propietario
  nativo, para evitar redimensionar y restaurar una imagen que se va a ocultar.
  Un fallo al copiar los mosaicos restaura la habitación completa anterior.

Las dos fixtures nuevas de devolución preparan sus registros dentro de la
transacción inicial de IndexedDB antes de abrir la aplicación. Se conserva el
contenido de las pruebas posteriores, incluidos sus presupuestos de ocho
segundos; se elimina el arranque vacío y la recarga que consumían el plazo global.

## Evidencia de CPU de esta fuente

La ejecución local completa de `full-local-attempt1` obtiene:

| Comprobación | Resultado |
| --- | --- |
| Unitarias | 2.796/2.796, 200 archivos, sin fallos, pendientes ni todo |
| Build de producción | PASS, salida 0 |
| Verificación Python de Android | 51/51 PASS |
| Verificación Python de segundo plano | 24/24 PASS |
| Censo E2E con el entorno completo de CI | 524 casos únicos, todos requeridos, sin omisiones |

El censo usa `--list`: **no son 524 pruebas de navegador ejecutadas**. Los 476
archivos de fuente incluidos en la comprobación permanecen iguales antes y
después; la documentación se excluye de ese guard. La ejecución local usa
Windows, Node 24.13 y Python 3.9; CI usa Ubuntu, Node 22 y Python 3.12.

El build genera `main-DNCbpyO0.js`, 1.444.385 bytes, SHA-256
`e988145ceda60cb2284407c7a70020fc6dd6753eefbefc117cacc272ce18da32`.
El resumen original está en
`.animation.local/performance-1747/full-local-attempt1/summary.json`.

Las comprobaciones focales preservadas incluyen 12 casos de la cola, 32 casos
de vida útil de los caches y contratos originales, y 24 de propiedad nativa y
contratos originales. Son pruebas de CPU con mocks de renderer y DOM. Los casos
del editor verifican cero modelos completos adicionales en cuatro ediciones
preparadas; el control anterior construye uno. Las cubiertas pendientes y
fallidas siguen construyendo el reemplazo anterior. Estos recuentos no son una
medición de tiempo ni de memoria física de la GPU.

## Límites medidos de 1.7.46 que siguen abiertos

La comparación serial en un escritorio con Intel UHD 630 y ANGLE D3D11,
viewport emulado de 390 × 844 a DPR 2 y los gestos originales de seis libros,
registra 2.760,4 ms en el control 1.7.45 y 2.755,2 ms en la publicación 1.7.46.
La diferencia de 5,2 ms **no demuestra una mejora de velocidad**. Durante el
retorno desaparecen las 14 copias GPU a 2D observadas en el control. El segundo
RAF posterior al final de la clase tarda 41,5 ms y 122,6 ms respectivamente.
Estos datos no acreditan fluidez de un teléfono Android físico.

El caso pesado de seis libros con SwiftShader conserva su resultado original:
9.012,6 ms y **FAIL frente al presupuesto intacto de 8.000 ms**. La eliminación
de readbacks y el recorte del buffer no resuelven por sí solos ese objetivo.

Los oracles estáticos previos conservan 42 comparaciones RGBA y 21 pares de PNG
exactos, y cinco poses adicionales con una página PDF real exactas. El oracle
de composición del prototipo mantiene su **FAIL estricto** por diferencias de
un nivel RGB en algunos pares de inserción, con alpha idéntico. No se aumentan
tolerancias ni se convierte ese resultado en PASS. La publicación 1.7.47 aún
requiere sus propias verificaciones de navegador y publicación.

La CI original de 1.7.46 (`37216005998`, fuente
`77de3f779c53560a564f3094e00b2419da7e0bad`) permanece **FAILED**: 519 de 524
casos E2E pasan; cinco fallan también en su reintento. Se preservan los 529
intentos, los doce logs y los once ZIP originales. Los cambios de esta versión
abordan las causas identificadas, pero sus unitarias no sustituyen la CI de
navegador completa.

## Navegador local de esta fuente

La primera ejecución `local-browser-attempt1` pasa los seis casos originales,
sin reintentos ni cambios de plazos: devolución en ambas vistas y desde el
lector, cancelación al cambiar el viewport, editor móvil, entrega nativa a
390 × 845, fondo legado a 393 px y gesto isométrico. Los dos contratos de
devolución mantienen el plazo global de 30 segundos y el cierre de ocho.

En el gesto se observan 20 composiciones de la imagen preparada, cero
repintados completos de la escena y dos escrituras de dimensiones de buffer,
frente a las cuatro de la publicación anterior que fallaban el contrato.
Geometrías, texturas y programas permanecen estables entre esos fotogramas.
Los textos de los seis libros vuelven a su resolución de 1.024 px al terminar;
las luces, las selecciones y el mapa de interacción siguen funcionando.
Esto prueba reducción de trabajo; no mide FPS ni fluidez de un teléfono.

## Verificación pendiente

Los resultados de CI y de la publicación final se incorporarán tras ejecutarse.
Siguen pendientes la comprobación del teléfono físico y la sesión real de
Google. La APK 1.1.4 continúa cargando la publicación web mediante su loader;
las verificaciones anteriores mantienen su fuente y alcance propios.
