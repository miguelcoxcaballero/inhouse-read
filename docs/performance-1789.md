# Preparación de la página 3D — 1.7.89 en preparación

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
