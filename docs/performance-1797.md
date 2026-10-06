# Web 1.7.97: transiciones más ágiles

Se centralizan los tiempos de apertura y cierre del libro. La apertura
programada pasa de 1.820 a 1.380ms. En el regreso 3D al hueco, las fases
programadas pasan de 1.929,6 a 1.529,6ms. Son tiempos configurados; un
equipo lento puede tardar más en dibujar, y se mide por separado.

Se mantienen la portada que espera un toque, la página de lectura real,
el marcapáginas, el zoom y la devolución. No cambian geometría, luces,
materiales, texturas, DPR, trayectoria, reloj del renderer ni su `maxStep`.
Las esperas usan el mismo tiempo que su animación, tanto en WebGL como
en el fallback. El movimiento reducido conserva sus fases de 1ms.

## Batería local

`.animation.local/performance-1797/full-attempt1`: 3.505/3.505 unitarias
en286 archivos, build y92 Python PASS. Censo526 E2E sin skips: el listado
no ejecuta navegadores. Se conservaron los bytes del runtime/config/tests,
incluido Android, antes y después. Entorno Windows/Node24; la CI original
usa Ubuntu/Node22 y se informa por separado.

La nueva fuente incluye el reloj Android1.1.7/código20. Sus ocho casos
Java ejecutan el método de producción; el caso de timestamp antiguo
fallaba con1.1.6 y pasa tras corregirlo.
[Detalle](native-clock-resilience-117.md).

## Comprobaciones pendientes al publicar

Recorridos locales originales, SwiftShader original, web real/offline,
CI completa y descarga independiente del APK1.1.7.

Los fallos anteriores quedan conservados: Native8s y retorno del editor
en la CI anterior, y una textura observada como cuerpo vacío en cada
tanda pública1.7.96. No se repiten para transformarlos en PASS. Los
nuevos recorridos pertenecen a la fuente con tiempos nuevos. No se
certifican FPS, temperatura, batería física o login real de Google.
