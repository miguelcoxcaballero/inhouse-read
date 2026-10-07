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

## Comprobaciones tras publicar

Fuente cb6de079b311e33325363cb1d3fc18b25a0a3b7f, Pages2931fef.
Siete recorridos locales y dos originales SwiftShader PASS, cero retries;
los límites30s/8s y la fórmula maxStep original permanecen intactos.
Los archivos del modelo, estudio, portadas y plantas son idénticos a d3bdd6a.

HTTP32 módulos/96 recursos offline PASS. Archivo real main-C295SPK3.js,
608.201 bytes, SHA256
b7fb128bed892457594c347853f6c7351376d0f2b784b267c92fe7cb97edb804.
Tanda pública26:24PASS/2FAILED, sin retries. Un regreso y el tema papel
fallan en la auditoría posterior de textura: el cuerpo observado por
Playwright fue cero, HTTP200. Se conservan ambos originales; no se
transforman en PASS. Las comprobaciones funcionales anteriores completaron.
Catálogo/plantas5/5PASS.

Offline real PASS: bytes del PDF3143 y SHA9093ab4b..., imagen[230,35,50],
textOffset115 conservado al guardar, recargar y reabrir sin Drive.
Cinco temas: raster/papel exactos y worker desde la caché real PASS.
Portada800x1600 JPEG150310 bytes, worker real y cero fallback PASS.

APK1.1.7/código20 descargado:78.531.659 bytes, SHA256
961a3f120490f3898459483bb110938cf0fd979a58f00dec81eb8f57264e14bb.
Firma v2 con certificado15a1f89c... PASS. Loader2107 bytes/bc0fcb2f...,
sólo index.html y los dos archivos cordova: sin app antigua empaquetada.
Manifiesto público7ffc9bb coincide con esa descarga.
Artefacto original Android37540922102 autenticado y hash ZIP comprobado:
1d763fdfcc7d6c97a0b2e5c270b4eb771e028699fb8bcd808859197fe44a5461.
Certificación Android15 PASS:367682ms bloqueado,368,91s de audio,
capítulos0..22, sin errores; pausa/reanudación/parada desde notificación.
PDF bloqueado cambia entre páginas0 y1 con14 inicios/49,50s de audio.
Es emulador, no una medición de teléfono físico.

CI37542191118 aún en ejecución. La CI anterior d3bdd6a se recogió
completa:526 casos/529 intentos, tres casos fallan también en sus retries.
Los cuatro grupos de voces con pesos reales PASS. El caso de gesto del
editor se reprodujo por separado y la traza muestra cambio accidental
Portada→Lomo por un encabezado recortado a1px. Se corrige en1.7.98;
no se declara que esa espera fallida midiera lentitud de dibujo.

Los fallos anteriores quedan conservados: Native8s y retorno del editor
en la CI anterior, y una textura observada como cuerpo vacío en cada
tanda pública1.7.96. No se repiten para transformarlos en PASS. Los
nuevos recorridos pertenecen a la fuente con tiempos nuevos. No se
certifican FPS, temperatura, batería física o login real de Google.
