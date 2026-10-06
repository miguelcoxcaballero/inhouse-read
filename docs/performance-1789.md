# Preparación de la página 3D — 1.7.89 publicada

La compilación de la página oculta entrega su lote al driver antes de
consultar su preparación. Devuelve los mismos materiales y no dibuja,
espera, cambia targets ni altera shaders, DPR o geometría. Mantiene la
recuperación original en el primer dibujo si el driver falla.

Siete pruebas nuevas,35 enfocadas PASS. La primera tanda encontró un error
de encadenamiento opcional al devolver undefined desde getContext; el
candidato final conserva ese caso y pasa la regresión. No se oculta la
primera tanda fallida ni se afirma una mejora causal de FPS. Batería,
recorridos gráficos y publicación todavía pendientes.
Evidencia: .animation.local/performance-1789/.

La batería final pasa3462 unitarias/278 archivos, build y75 Python. Fuente
658 estable;524 sólo listados, cero E2E ejecutadas en ese censo. El control
aisladamente conserva los bytes de1.7.88: cuatro casos existentes pasan y
la nueva integración falla exactamente por ausencia de entrega del lote.
Su primer helper no cargó por una ruta relativa errónea del config; se
conserva ese arranque sin tests y el ensayo posterior por separado.

Los siete recorridos gráficos originales pasan en su primer intento con
30/8s nativos intactos. Cierres5491,7/4881,4ms en esta tanda local; no son
comparaciones causales ni mediciones de móvil. El gesto isométrico conserva
el renderer, los targets y la resolución de los seis libros. Catálogo,
luces y regressiones adicionales siguen en marcha. Publicación pendiente.
Evidencia: full-local-resource2-attempt1/, before-control-attempt1/ y
local-browser-attempt1/.

## Resultado publicado — 6 de octubre

Web1.7.89 publicada desde ea23c128535b77a9c60e12a251349500910e3f4f.
Deploy37433923582 PASS; gh-pages d6d59665ad1e2424f65e71c7fb9bf3d1c38017b1.
La descarga HTTP real conserva32 assets y96 recursos offline; main
main-Bm9DRdKg.js SHA256
01af5534538ad65f9103418cd516fffb76d341cf9ec2fdd66ed44f48013c9679.

Dieciséis recorridos gráficos locales originales PASS en el primer intento:
siete generales, cinco catálogo, dos regreso y dos SwiftShader. Conservan
los plazos30/8s y no miden FPS de teléfono. Los26 recorridos de la web
publicada y sus auditorías estrictas pasan, cero retries.

La app pública importa el PDF sin conexión y conserva sus bytes exactos,
las dos imágenes con RGB original y el locator textOffset115 al cerrar,
recargar y abrir de nuevo. driveFileId permanece null. Papel físico y
snapshot estabilizado en cinco temas, y portada JPEG offline, PASS usando
el service worker real; sin sustituciones de respuestas.

APK público descargado de nuevo:1.1.4/code17,78515243 bytes, SHA256
feafaaa762b35344ac8b19418f9f6eb6cb1f725fba22b1ef3d3f273bd32a6191.
Su loader2089 bytes coincide con el fuente; no incluye una copia vieja de
la web. No hubo cambio nativo ni nuevo build. La verificación en emulador
37432501323 corresponde al APK idéntico y al momento de la web1.7.88;
no se atribuye su sesión a esta versión web. Detalle en performance-1788.md.

CI original37433923469 termina FAILED:3462/278 unitarias PASS;524 casos
E2E únicos,527 intentos,3 retries y5 intentos fallidos. Sólo UI3 falla:
regreso alineado supera30s en ambos intentos; fraccionario falla esperando
la página PDF visible8s en ambos; luces falla primero y pasa su retry,
que sigue siendo flaky rechazado. Las otras cinco UI y las cuatro tandas
de voces reales pasan. Los once ZIP y doce logs originales se conservan;
no se sustituye este resultado por recorridos locales aprobados.

El diagnóstico de consultas GL del regreso conserva su primer fallo8s.
La nueva consulta del shader del marcapáginas cuesta15,2ms en esa tanda,
no segundos; no justifica cambiar su geometría o precargar un marcador
ficticio. Las consultas no explican por sí solas la demora. Rendimiento
completo todavía pendiente; no se declara toda la app resuelta.

Evidencia adicional bajo .animation.local/performance-1789/:
catalog-browser-attempt1/,return-regressions-attempt1/,
swiftshader-original-attempt1/,public-ea23c12-attempt1/,
ci-original-37433923469-attempt1/snapshot-002/ y
return-shader-observer-attempt1/. Los párrafos anteriores conservan el
estado histórico de cada ejecución; este apartado es el resultado final.
