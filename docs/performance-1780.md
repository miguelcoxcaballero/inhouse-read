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
canvas continuo y cambio de lámparas, sin retries. Publicación pendiente. Evidencia:
`.animation.local/performance-1780/`. No se afirma un benchmark en teléfono.

El diagnóstico separado de 393 px con los flags originales SwiftShader,
observador de marcas y sin perfilador CPU pasa dentro de los límites originales:
cierre completo de 6.500 ms. Código/build/métodos idénticos antes y después,
sin retries. No sustituye los originales CI fallidos de la entrega anterior.
