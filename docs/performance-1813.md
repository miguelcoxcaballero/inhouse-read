# Continuación: límite global de la caché de portadas ampliadas

## Candidato 1.7.112

La caché conserva un máximo global de 2.097.152 píxeles (8 MiB RGBA), además
del límite por imagen de 1.7.111. Cuando otra portada necesita espacio se libera
la base menos recientemente utilizada. Las texturas de los modelos visibles
conservan sus píxeles y sus propios ciclos de vida. Seleccionar una portada
retenida renueva su prioridad; cerrar su última copia devuelve el presupuesto.
No se cambia resolución, modelo, material, iluminación o reloj de animación.

Evidencia: `.animation.local/performance-1813/`. 112 focales PASS, incluidos
tres casos nuevos de presupuesto global, prioridad y devolución de espacio.
Comparación con el renderer real: se fuerzan cuatro portadas decodificadas y
la expulsión de la primera; el libro todavía visible conserva exactamente
la textura RGBA y los fotogramas de frente, 35° y 90°. Errores GL cero y
118.391/109.962/32.816 píxeles pintados. Esto acredita calidad en esa muestra,
no una aceleración sostenida ni FPS, consumo o temperatura de un móvil físico.

La batería completa, publicación y verificación públicas están pendientes.
La verificación 1.7.111 se conserva en [su informe](performance-1812.md);
sus fallos originales de captura y la CI todavía pendiente no se borran.
