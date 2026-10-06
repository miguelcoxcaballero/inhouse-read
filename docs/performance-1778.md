# Reserva de la estantería compartida — 1.7.78

La estantería comparte el renderer GL con el libro, incluso cuando presenta
su imagen en un canvas 2D. Su resize todavía cambiaba primero el DPR y
después el tamaño. En un cambio de ambos eso reservaba cuatro buffers no
vacíos, aunque sólo se dibujaba el último.

El nuevo helper usa la misma reserva atómica y el mismo resize síncrono
protegido que el libro, tanto para la captura de la sala como para la
inserción. Conserva la política existente de presentación, DPR, tamaño
físico, viewport y redondeo fraccional. No modifica modelos, iluminación,
texturas, animaciones ni relojes.

Pasan 24 pruebas enfocadas en tres archivos. Las cinco nuevas comprueban
cuatro reservas frente a una con estado final idéntico, DPR 1,5 y viewport
redondeado, frame sin cambios, guard de XR y rechazo del staging con scissor.

El diagnóstico previo de 1.7.77 conserva su FAIL de cierre a 8 s. Usa
SwiftShader, profiler CDP y observadores adicionales; no acredita rendimiento
de un teléfono ni sustituye CI. Sus stacks de setSize/setDrawingBufferSize
identifican las capturas de sala y de inserción sobre el bundle local exacto.
Su perfil, clocks CDP, fases, bundle y métodos quedan guardados separados.

Pasan 3.389 unitarias en 266 archivos, build y 75 comprobaciones Python.
El listado de 524 E2E no se cuenta como ejecución. Ocho comparaciones GL
reales conservan exactamente los bytes RGBA, dimensiones, DPR y viewport
del modelo con materiales oro/plata, cerrado, abierto y girado, incluidos
tamaños fraccionales. No hay errores GL ni de página en ese diagnóstico.

Pasan los siete recorridos gráficos originales sin retries; los dos cierres
nativos locales tardan 4.831,1 y 4.901,1 ms. Son observaciones de esta máquina,
no un benchmark móvil. La tanda original de catálogo conserva cuatro PASS
y un FAIL: la luz de nogal tras recargar no completa su primer frame dentro
de los 8 s originales. Se guardan informe y traza completos; no se cambia
el plazo ni se cuenta la tanda como aprobada.

Otros dos recorridos originales de reutilización de canvas y luces tras
recarga pasan sin retries.

Publicada `a02e5a7`, Pages `b62ff50`, main `main-eiCftkzs.js`, SHA256
`8ceac43ffb65690a7003e743a5c4e1b9e32c243454d2129f1f10597f5e126e7d`.
HTTP32/offline96 y APK/loader descargados PASS. El APK conserva 78.515.243
bytes y el loader exacto de 2.089 bytes, con sólo los dos scripts Cordova;
no hay código nativo nuevo ni una APK nueva.

Pasan los 18 casos PDF públicos con auditoría de 587 cuerpos y 15 capturas,
los cinco de catálogo/plantas/luces, y los dos contratos de retorno nativo.
La tanda pública de tres conserva un FAIL del editor en su auditoría HTTP:
una respuesta de textura de 209.252 bytes devuelve cuerpo vacío; sus
aserciones de interfaz pasan, pero no se cuenta la tanda como aprobada.
Las peticiones directas del artefacto mantienen bytes/hash correctos.
No se altera ese fixture ni se reintenta para ocultar el fallo.

Papel real offline en cinco temas PASS, sin readbacks en el hilo principal;
portada PDF/JPEG offline 800×1600, 150.310 bytes y cero fallback PASS.
El primer pin público conserva FAIL del índice anterior durante propagación;
el segundo corresponde a la versión nueva. CI original `37396014605`
termina FAILED, conservando 11 ZIP y 12 logs autenticados. Su censo completo
contiene 524 identidades y 528 intentos, cuatro retries y seis intentos
fallidos. UI3 falla en los cierres nativos originales de 8 s, ambas veces.
UI6 conserva dos casos flaky: primer frame de lámparas tras recarga y libros
tras recarga. Las cuatro tandas de voces reales, unitarias y demás UI pasan.
No se afirma aprobación global. Colección sellada sin incidencias en
`ci-original-37396014605-attempt1/snapshot-001/summary.json`.
Evidencia: `.animation.local/performance-1778/` y
`.animation.local/performance-1777/swiftshader-closing-cpu-attempt1/`.
