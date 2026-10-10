# Continuación: fotogramas del libro y página física

## Cambios preparados para 1.7.114

La animación del libro presenta un solo fotograma pendiente en la GPU.
Una fence se consulta con espera cero; mientras no termina, se conserva
la pose visible. El último fotograma también termina antes de entregar
la fase siguiente. Se mantienen sampler, pasos de48/100 ms, resolución,
modelos, materiales y todos los plazos originales de prueba. Los contextos
sin soporte conservan la ruta anterior; cancelación y pérdida del contexto
liberan la fence.

Las dos copias de una página PDF sin filtros conservan identidades y bytes
propios, pero comparten medición del papel y textura GPU cuando el lector
prueba igual fuente/filtro/resampling. Los demás temas, brillo y navegación
siguen invalidando o separando esas revisiones. Las fotografías no cambian.

## Investigación conservada

Evidencia nueva en `D:/CodexEvidence/InhouseRead-20261010/`; contiene un
junction node_modules a las dependencias del repositorio y no debe moverse
ni borrarse recursivamente siguiendo ese enlace. Los métodos pequeños están
en `.animation.local/performance-1815/` y `release-114-methods/` en D.

Se descartaron iniciar antes el worker, cambiar su rasterizador y preparar
la página antes de acabar la salida: no acreditaban mejor rendimiento total,
y la última opción alargaba la salida en SwiftShader. Sus originales siguen
en los directorios retired y sus diagnósticos; no se publican esos cambios.
La restauración de app/prepared-page y los dos primeros módulos conservó
los hashes de bytes de trabajo anteriores, incluidos sus finales de línea.

El control de cola GPU pasa dos diagnósticos instrumentados con los límites
originales30 s/8 s:21,7 y20,8 s completos. Desde restaurar hasta snapshot,
95,7 y28,7 ms. No es prueba de FPS, calor o batería de un teléfono real.
Las comparaciones anteriores, sin fences, conservan sus dos FAIL independientes
de cierre. Compartir la medición por sí solo no acredita una aceleración global.

35 nuevas unitarias cubren fences, medición compartida, prueba del lector y
texturas. Los originales se mantienen. Batería definitiva:3.680 unitarias
en300 archivos, build y105 Python PASS;533 casos E2E censados.

Comparación GPU independiente: cinco poses, RGBA exacto, dimensiones y
viewport iguales, cero errores GL y una textura frente a dos. La página
sintética contiene zonas RGB; no constituye una medición del teléfono.
El primer diagnóstico queda FAIL: leyó con PIXEL_PACK_BUFFER enlazado y
obtuvo INVALID_OPERATION/píxeles cero. La segunda versión del método
desenlaza y restaura ese buffer sólo durante la lectura. Ambos se conservan.

Siete recorridos originales locales:seis PASS y un FAIL en el regreso
nativo a393px: cierre3,894 s, pero ninguna muestra de inserción nativa.
No se relajan sus aserciones ni30 s/8 s. Un diagnóstico posterior con
observación de las puertas de entrega pasa18,8 s; no reproduce ni explica
el fallo y no sustituye el resultado original. El build diagnóstico no
genera sw.js y conserva el error de registro offline propio del método.
El fallo nativo y el rendimiento general siguen pendientes. Publicación y
comprobaciones de web/APK pendientes.
