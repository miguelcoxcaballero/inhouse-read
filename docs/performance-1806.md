# Web 1.7.106: publicación y verificación

## Cambio entregado

El constructor del libro envía al driver su lote inicial de compilación
mediante el mismo helper que prepara la página. Se conservan geometría,
materiales, luces, resolución y duraciones. No se añade un dibujo ni una
espera con `finish`. Los renderers sin materiales y los errores mantienen
su recuperación anterior.

Cuatro regresiones nuevas prueban los constructores privado/compartido,
el error del driver y la estantería estática. Focales: 37/37. El control
contra 1.7.105 falla en las tres comprobaciones nuevas de envío del lote.
El primer harness falló porque trataba `{view}` como `view`; se conserva.
Ninguna aserción, fixture o espera original se modificó.

## Artefactos publicados

- Fuente: `666519c0413a75bf6839e9f9fdc6b15dd5afb433`.
- Pages: `d053818d9785b5ca8c51092ccc9f3ecc6987765c`.
- Main: `assets/main-BbeKhGuY.js`, 610.762 bytes.
- SHA-256: `e055b214974dea79739b8928e1dace02df65e653f47a51b5747f4a60b21e318f`.
- Los 32 recursos del grafo y las 96 entradas offline coinciden por HTTP.
- APK público 1.1.7/code20 descargado de nuevo: firma, hash y loader de
  2.107 bytes correctos. Sólo contiene el loader y los dos archivos Cordova.
  Su manifiesto es idéntico en las fuentes 105/106; este cambio web no
  requiere una APK nueva ni empaqueta una copia antigua de la app.

## Resultado de las pruebas

| Comprobación | Resultado |
| --- | --- |
| Local: 3.591 unitarias / 291 archivos, build y 92 Python | PASS |
| Siete recorridos locales originales | PASS, sin reintentos |
| Dos recorridos originales SwiftShader | PASS, límites 30 s/8 s intactos |
| Web real: 32 recorridos funcionales | PASS |
| Auditoría estricta de esos recorridos | 31/32; un fallo de captura conservado |
| Cuatro recorridos offline | PASS |
| CI completa 37566824483 | FAIL: dos casos nativos de 526 |

Los recorridos offline conservan bytes y progreso, imágenes con sus RGB
originales en cinco temas, portada JPEG real y la primera portada al
cerrar inmediatamente. Las 18 pruebas PDF publicadas, cinco de catálogo/
plantas/luces y cuatro del puente Android pasan sus auditorías estrictas.
El puente web observado no equivale a probar un teléfono físico.

CI ejecutó las 526 identidades: 524 casos pasan; ambos casos nativos
390/393 px agotan 30 s en su primer intento y en su reintento. Son 528
intentos, dos reintentos y cuatro intentos fallidos. Los otros cinco bloques
de interfaz y las cuatro familias de voces con pesos reales pasan.
Supertonic completa sus 220 perfiles offline. El catálogo sigue ofreciendo
39 voces Piper y diez personas Supertonic en 22 idiomas; los perfiles no
se cuentan como personas nuevas. No se añadieron voces en esta versión.

## Fallos que siguen abiertos

**Rendimiento del recorrido 3D.** CI tarda aproximadamente 26–27 s en
llegar a Back, casi todo el presupuesto global de 30 s. El teardown corta
la comprobación de cierre de ocho segundos; no es una medición independiente
de un cierre completo de ocho segundos. Se conservan las cuatro trazas.
Las muestras locales de cierre 5.537,8/7.270,9 ms no demuestran una mejora
sostenida frente a 105. No se considera resuelta toda la lentitud.

**Captura de textura.** El auditor original recibe HTTP 200 pero registra
0 B para walnut-surface. Las aserciones funcionales del editor pasan;
su auditoría de transporte falla. Un experimento separado, con seis casos,
recibe ambas texturas completas a través del `Response.blob` real, con
hashes correctos (151.604/209.252 bytes), pero no reproduce el fallo original.
No se reemplaza ese fallo por el resultado posterior ni se declara 32/32.

Un perfil separado de CPU completa el escenario 393 en 25,8 s. Sus 24,99 s
de muestras incluyen 17,56 s de idle y 2,70 s de program; idle mezcla esperas,
animación, red y GPU. No permite atribuir toda la demora a una función o al
renderizado. El primer harness omitió una dependencia del espejo y no ejecutó
pruebas; ambos intentos quedan separados. El perfil usa el build Windows
`main-CpMdUtAm.js`, no los bytes publicados por Ubuntu.

No se midieron FPS, calor ni batería de un móvil físico ni se completó una
sesión humana autenticada de Google en esta tanda.

## Evidencia conservada

Directorio `.animation.local/performance-1806/`:

- `full-attempt1/`, `local-browser-attempt1/`, `swiftshader-original-attempt1/`.
- `public-666519c-attempt1/`, `browser-batch-summary.json` (FAIL original)
  y `browser-rest-summary.json` (recorridos restantes PASS).
- `app-blob-diagnostic-attempt1/`, `supplemental-observation-certificate.json`.
- `native-ci-original-timing-complete.json`, `cpu-profile-diagnostic-attempt{1,2}/`.
- `ci-original-37566824483-attempt1/`: ZIP autenticados, censos y trazas originales.

APK: `.animation.local/performance-1796/apk-1.1.7-web17106-attempt1/`.
Los informes fallidos y los límites originales se conservan.
