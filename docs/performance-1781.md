# Origen de la estantería al actualizar su estructura — 1.7.81

El ajuste de píxeles de una estantería pertenece a su elemento HTML. Al
sustituirlo conservando el renderer, se restaura el top de la estructura
anterior y se captura el top original de la nueva. Su ajuste empieza en cero:
la primera pintura calcula su propia posición, sin restar un desplazamiento
que todavía no se había aplicado a ella. Actualizar la misma estructura
conserva el ajuste existente. Dispose restaura la posición de la nueva.

Esto conserva el canvas y los modelos/GPU existentes, luces, sombras,
resolución y relojes. No modifica el tamaño ni desplaza sólo los hit targets.

Cuatro regresiones nuevas usan la escena real con renderer/cache simulados.
La fuente anterior reproduce tres FAIL y un PASS. Después pasan las cuatro,
junto con las originales de origen, inserción y ownership: 28 PASS en cinco
archivos. Se conserva el informe anterior. La batería CPU pasa: 3.411
unitarias/270 archivos, build y 75 Python; 647 archivos de código/tests/config
idénticos antes y después. Censo de 524 E2E, sólo listado en esa tanda,
cero ejecutados u omitidos. Los siete recorridos gráficos originales pasan,
sin retries u omisiones, con código/build/métodos idénticos. Los cierres
nativos completos tardan 5.282,1/4.805 ms dentro de sus 8 s originales;
no se comparan con otras cargas como mejora de velocidad ni representan
un teléfono. Pasan los cinco casos originales de catálogo/plantas/luces y
las dos regresiones adicionales de continuidad de canvas y lámparas,
sin retries ni cambios de fuente. Evidencia en
`.animation.local/performance-1781/`.

El diagnóstico de origen de 1.7.80 sobre su publicación observa posiciones
coherentes en dos arranques independientes: 845 px alinea a 62 y 844 px
conserva 61 con el framebuffer fraccionario original. No reproduce el FAIL
intermitente de la tanda pública y no sustituye esa tanda ni demuestra por
sí solo su causa. El fallo de ownership por sustitución se acredita aparte
con las tres regresiones anteriores; no se atribuye causalmente todo fallo
público al mismo problema.

## Publicación comprobada

Publicada desde `d71472b` en Pages `54baf9d`, main `main-DrRTV-Op.js`,
591.484 bytes, SHA256
`170b4656572751bb5e1be3d992e228e19577a71eedb187440758242b5c938593`.
El primer pin observó el índice anterior durante propagación; se conserva.
El segundo coincide con los bytes Git publicados. HTTP32/offline96 y nueva
descarga APK/loader exacto PASS. Android sigue 1.1.4/code17, loader 2.089
bytes; no se afirma nueva ejecución en teléfono.

La comprobación adicional conserva el almacenamiento real del navegador
entre las publicaciones efectivas 1.7.80 y 1.7.81, sin sustituir respuestas
ni escribir datos de IndexedDB. Ambos mains recibidos coinciden con sus pins.
El atlas mantiene clave, dimensiones, 6.291.456 bytes, palabras y ocho
propiedades del sampler; SHA256
`2a0281e22b3a47dd6f08f2ddda76c7b6d146d27a4a892d168f4ebd4d28fb8d7e`.
Una exportación HDR en el arranque 80; ninguna en el arranque 81. Se cierra
la app durante la espera de publicación y después todo el navegador. No es
un benchmark de velocidad. Evidencia `studio-cross-release-attempt1/`.

Los tres recorridos públicos de editor/retorno pasan sin retries, con 99
cuerpos de app auditados. Pasan los 18 PDF públicos: 591 cuerpos y 15
capturas, sin retries. Pasan los cinco casos públicos de catálogo/plantas/
luces; código y hash público idénticos antes/después. Papel offline original
y default/reuseSettledLayout PASS en cinco temas, con píxeles exactamente
iguales, copias nuevas e identidades de raster conservadas. Portada offline
PASS: JPEG 800×1600/150.310 bytes, sin fallback. No se sustituye ninguna
respuesta de la app ni se cambian límites/aserciones/fixtures originales.

CI original `37404429710` sigue en marcha con fallo confirmado en UI3;
falta el censo completo y no se afirma aprobación global.
