# Web 1.7.100: conservar margenes vacios pequenos durante el vuelo

El diagnostico del cierre en1.7.99 observa un reset de ancho de402,6ms
cuando el recorte cambia de390 a384px. La nueva reserva conserva como maximo
16 columnas logicas vacias si solo se reduce el ancho, la altura y el DPR
son identicos y el framebuffer real coincide con el tamano anterior.
Cambios grandes, dimensiones fraccionales, legado, camara completa y DPR
nuevo siguen la asignacion anterior. La proyeccion conserva el viewport
original; las columnas adicionales quedan transparentes. Se restaura el
viewport al volver a ampliarlo, aunque no haga falta redimensionar.
La escala CSS usa el ancho reservado para no estirar los pixeles.

41 pruebas enfocadas PASS (16 nuevas).60 pares RGBA exactos PASS contra
el modulo1.7.99:30 poses/acabados y30 con pagina/texto/imagen originales.
Se comprueba una reserva mayor real y la escala CSS correspondiente.
El experimento previo con marcapaginas registra30 iguales peroFAIL por
no activar la reserva; se conserva. Los dos primeros ensayos
comparaban una reserva retenida contra una liberada y registran FAIL por
un canal con delta2. Ambos fallos quedan conservados. Los dos siguientes
fallan por asumir una escala CSS1 en una pagina sin CSS. La comparacion
final utiliza el mismo estado de reserva en ambos modulos y comprueba la
escala CSS real; no convierte ninguno de los fallos anteriores en PASS. Ninguno se publico ni altero
las pruebas originales. No cambian materiales, geometria, luces, resolucion,
sombras, DPR ni formula original maxStep.

Bateria completa:3.528/3.528 unitarias en289 archivos, build y92 Python PASS.
Censo526 sin skips es listado, no ejecucion E2E. Fuentes/config/pruebas
protegidas antes/despues.

## Publicacion y ejecuciones verificadas

Web publicada desde706bc687cd8b1bf514e4fb1360b5e94a3882ceb6;
Pagesaac43e30c01e0452618474147d5d210b89135057.
HTTP32/shell96 PASS. Main609.061B, SHA256
d4ef677fe5d151f4d41adffc9e02d55c5ce5fd919dd463152c3b27dcea39a2d3.
28/28 casos publicos estrictos PASS en su primera ejecucion: cinco de
nombres/editor/gesto/regreso,18 PDF y cinco catalogo/plantas/luces.
Auditorias de recursos incluidas, sin retries. Los fallos de otras versiones
no quedan sustituidos por estos resultados.

Tres recorridos offline PASS: bytes3.143, locator115 y foto[230,35,50]
al recargar y reabrir; papel/pagina exacta en cinco temas con el worker real;
portada800x1600, JPEG150.310B y encoder real, cero fallbacks.
Los siete originales locales PASS (cero skips/flaky/retries), incluidos
regresos390/393, continuidad, cancelacion, editor movil, movimiento
isometrico y reserva sin WebGL. Los dos originales con SwiftShader PASS
con esperas30s/8s y assertions intactas. Son nueve casos integrados locales,
no toda la bateria E2E ni una medicion del movil fisico.

El diagnostico independiente del cierre con SwiftShader registra5.710,2ms
frente a7.004,1ms del diagnostico anterior; ambos son observaciones locales,
no un benchmark de dispositivo. Todavia se observan resets de altura.
CI original37549345628 sigue pendiente: no se declara resuelto su limite8s.
APK1.1.7/codigo20 independiente sigue verificado y no requiere rebuild por
este cambio web. Pruebas APK/emulador y alcance en performance-1799.md.
Se vuelve a descargar el APK real y el manifiesto servido con esta fuente:
78.531.659B, SHA256961a3f120490f3898459483bb110938cf0fd979a58f00dec81eb8f57264e14bb.
Firma v2 y certificado original PASS; loader2.107B, sin copia vieja de la web.
