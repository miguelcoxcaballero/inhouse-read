# Rendimiento 1.7.94 — aislamiento de la iluminación

Integra primero `b42c890` (web 1.7.93): nombres de libros, UI, luces y arranque.
El estudio se extrae a `src/js/studio-renderer.js`; sólo éste, sus dependencias,
el contrato de caché y la versión real de Three determinan el atlas persistente.
Cambios de movimiento, texto o apariencia de libro conservan ese atlas.
Una actualización desde la clave anterior recalcula una vez; no se migra un atlas
sin comprobar su generador. Esto evita trabajo en posteriores actualizaciones,
sin acreditar una mejora de FPS ni resolver por sí solo la apertura nativa.

## Evidencia local

- 63 focales en cinco archivos y tres de nombres de voces: PASS.
- 18 comparaciones WebGL2 de 1.7.93 frente a la extracción: cero diferencias RGBA;
  mate, oro, plata y seis poses, con marcador. Misma resolución y materiales.
- Control de clave: el algoritmo anterior invalida al cambiar el movimiento;
  el nuevo conserva la clave; cambiar un generador de luz la invalida: PASS.
- 3.493 unitarias / 284 archivos, build y 75 Python: PASS en la segunda tanda.
  La primera conserva un fallo por el nombre de APK antiguo en una expectativa.
  El verificador de censo asumió 525 en lugar de 526: su informe FAILED original
  se conserva; la auditoría independiente valida los mismos resultados y 526
  casos listados sin ejecutar todavía navegador. No se reclasifica una prueba fallida.
- Producción local: atlas 6.291.456 bytes SHA2a0281e22b3a47dd6f08f2ddda76c7b6d146d27a4a892d168f4ebd4d28fb8d7e
  idéntico al recargar; dos shaders PMREM en frío y ninguno al recargar: PASS.
  No se midieron píxeles de estantería en este recorrido; la identidad RGBA se
  acredita exclusivamente por las 18 comparaciones independientes.
- Siete recorridos originales locales principales y dos regresiones de recursos:
  PASS, sin retries; plazos y fixtures intactos. La tanda de siete conserva su
  error de guard previo: los inputs CPU preceden y coinciden después; no se
  declara un certificado específico de antes de la tanda que no se produjo.
- Nueve Python del contenedor: PASS con Python3.12.14. Python3.9 conserva el
  error de sintaxis de anotación de tipo del builder sin modificar el producto.
- PDF/catálogo, software adicional y publicación: pendientes.

Evidencia en `.animation.local/performance-1794/`, en particular
`studio-extraction-pixels-attempt1/` y `studio-version-control-attempt1/`.

## Audiolibro

El informe original `37530571056` de 1.7.93 falla en la expectativa del orden
antiguo del selector después de dar nombres y regiones a Supertonic. Ambos
intentos fallan; los ocho escenarios siguientes quedan sin ejecutar.
Se conserva ZIP original/report/identidad en `remote-1793-reading-original/`.
Se cambia sólo la secuencia exacta esperada de cinco IDs del selector y se
comprueba que conserva el catálogo completo. No se modifica el motor,
los pesos, los plazos o las aserciones de reproducción. La nueva CI real
sigue pendiente; un cambio de expectativa no acredita reproducción.

## Android

Se prepara 1.1.5/código18 para empaquetar el loader y el comportamiento nativo
ya añadidos en 1.7.93. `android-update.json` sigue apuntando al APK 1.1.4 real
hasta que el workflow firme, compruebe y publique el nuevo archivo y calcule
sus bytes/SHA. Emulador, audio bloqueado y descarga pública: pendientes.

## Intentos y límites

La preparación inicial local se basó en HEAD1.7.91; al consultar GitHub se
identificó la versión remota1.7.93. Se conserva la tanda CPU cancelada de
`performance-1792/full-local-resource2-attempt1/`; no se acepta como resultado.
Sus 18 comparaciones frente a 1.7.91 no sustituyen las nuevas frente a 1.7.93.
La primera extracción encontró finales LF y no escribió el producto; después
se adaptó sin alterar la función. La primera instrumentación GL no midió nada
por acceder a una propiedad getter: se excluye. El segundo diagnóstico conserva
la observación real. La copia final a canvas2D tarda 3,6–3,8ms localmente;
no explica la espera y se conserva. No se cambia el muestreo, los topes de paso,
los plazos nativos 30s/8s, la resolución ni los materiales.

Los dos fallos nativos originales de 1.7.91 siguen documentados por separado.
No se declara resuelta toda la lentitud, temperatura/batería/FPS de teléfono,
login autenticado de Google ni conversión perfecta de cualquier PDF.
