# Reutilización de iluminación entre actualizaciones — 1.7.80

El atlas HDR de la sala se conserva por una huella automática del código
3D, sus dependencias locales, el contrato de caché y los archivos reales de
Three. Un cambio de app, lector PDF o versión de producto sin cambios en
esas entradas mantiene la misma huella. Cambiar una entrada o el navegador
invalida el atlas. Desarrollo no lee ni escribe esa caché.

Se conservan todas las palabras half-float y propiedades del sampler,
generador, luces, materiales, sombras, resolución y relojes. No se añade una
espera a la apertura. El registro anterior con clave de URL no se migra:
se genera una vez con la clave nueva porque no tiene la huella que permita
acreditar sus entradas. La URL sigue como fallback para builds aislados
que no definen la huella.

Pasan 45 pruebas enfocadas en cuatro archivos, incluidas todas las originales
de atlas y bakes de plantas. Cuatro regresiones nuevas ejercen IndexedDB real
con transferencias simuladas, huella nueva, invalidación, conservación exacta
y modo desarrollo. La fuente anterior reproduce dos FAIL y dos PASS;
ese primer informe queda conservado. Otras diez comprueban el hash de la
fuente real y cambios de entradas, metadata irrelevante y finales de línea.

La batería CPU pasa: 3.407 unitarias en 269 archivos, build y 75 Python,
con 646 archivos de código/tests/configuración idénticos antes y después.
El censo mantiene los 524 E2E; esa tanda sólo los lista, no los ejecuta.
Pasan los siete recorridos gráficos originales y cinco de catálogo/plantas/
luces, sin retries ni omisiones, con la fuente/build/métodos idénticos.
Los cierres nativos locales completos tardan 5.017,6 y 4.970,0 ms dentro
de su límite de 8 s. No se comparan como mejora de velocidad con otras
cargas o máquinas. Pasan las dos regresiones originales adicionales de
canvas continuo y cambio de lámparas, sin retries. Evidencia:
`.animation.local/performance-1780/`. No se afirma un benchmark en teléfono.

El diagnóstico separado de 393 px con los flags originales SwiftShader,
observador de marcas y sin perfilador CPU pasa dentro de los límites originales:
cierre completo de 6.500 ms. Código/build/métodos idénticos antes y después,
sin retries. No sustituye los originales CI fallidos de la entrega anterior.

## Publicación comprobada

Publicada desde `c676d6f` en Pages `95fb9fe`, main `main-CuTfU44F.js`:
591.462 bytes, SHA256
`4a695dda4a5dccc4e02588d334902fe8d623664760689d1c638954af0d64e833`.
HTTP32/offline96 y descarga nueva APK/loader exacto PASS. Android sigue
1.1.4/code17. Loader de 2.089 bytes; no contiene una app antigua completa.

La tanda pública de tres conserva 2 PASS/1 FAIL. El caso alineado observa
la sala en `[0,61]`, DPR 1,5, y falla la precondición de origen integral;
también conserva una auditoría de textura con cuerpo vacío. Los 18 PDF
completan sus aserciones funcionales; el informe conserva 17 PASS/1 FAIL
de auditoría HTTP de otra textura vacía. No se cambian tests ni se repiten
estas tandas para convertir sus fallos en aprobaciones.

Los cinco casos públicos de catálogo/plantas/luces pasan. Papel offline
original y comparación default/reuseSettledLayout PASS en cinco temas,
con píxeles exactamente iguales, nuevas copias e identidades del raster.
Portada offline PASS: JPEG 800×1600, 150.310 bytes, sin fallback.

La comprobación adicional de caché real observa el atlas 768×1024,
6.291.456 bytes, clave `331c4709af94fbd292b6|UA`. Una lectura HDR inicial
y ninguna tras recargar; palabras y ocho propiedades del sampler idénticas,
SHA256 `2a0281e22b3a47dd6f08f2ddda76c7b6d146d27a4a892d168f4ebd4d28fb8d7e`.
Los dos cuerpos main coinciden con los publicados. Es recarga de una misma
versión; el hash ante cambios irrelevantes se comprueba aparte en unitarias.

El primer método adicional falló: Playwright considera truthy la Promise
del predicado de waitForFunction antes de conocer su booleano. Se conserva
el fallo. El método v2 espera cada lectura real de IndexedDB fuera de ese
poller, con el mismo límite de 30 s, y pasa. No cambia la app ni un test
original. No se afirma velocidad o ejecución nueva en teléfono.

CI original `37401328243` conserva FAILED. Recogida completa: 11 ZIP,
12 logs autenticados, 524 identidades/525 intentos; un retry y dos intentos
fallidos, cero incidencias de recogida. Unitarias, las cuatro tandas de voces
y UI1–5 PASS. UI6 conserva el primer frame de tres luces tras recarga,
esperado `data-active-lamp-lights=3`, observado vacío, a 8 s en ambos intentos.
Se conservan originales y trazas; no se afirma aprobación global.
