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
sin retries ni cambios de fuente. Publicación pendiente en
`.animation.local/performance-1781/`.

El diagnóstico de origen de 1.7.80 sobre su publicación observa posiciones
coherentes en dos arranques independientes: 845 px alinea a 62 y 844 px
conserva 61 con el framebuffer fraccionario original. No reproduce el FAIL
intermitente de la tanda pública y no sustituye esa tanda ni demuestra por
sí solo su causa. El fallo de ownership por sustitución se acredita aparte
con las tres regresiones anteriores; no se atribuye causalmente todo fallo
público al mismo problema.
