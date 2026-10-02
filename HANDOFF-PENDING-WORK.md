# Trabajo pendiente (guardado a mitad)

Estado a 2026-10-02. El trabajo se ha pausado para completar los paquetes UNO A UNO y gastar menos uso.
Todo lo que sigue está en ramas `wip/*` del remoto (sin revisar, sin verificar salvo lo que se indica).

## Ya en `main`
- Resaltado de frases del audiolibro arreglado (b4dd143): sigue el evento de inicio del motor de voz, PDF con el resaltado pegado al texto, frases no cortadas en abreviaturas/decimales, estilo limpio. 25/25 e2e y 1002 unitarios pasaron.

## Reparto entre agentes
- **ChatGPT** (ver `PROMPT-CHATGPT.md`): 3) controles del lector, 5) preparar la última página, 6) tamaños IKEA, 7) editor de portada con relieve.
- **Claude**: 1) voces neuronales, 2) papelera, 4) justificación de la página 3D.
- Ramas WIP (SHA): `wip/reader-controls-stable-layout` fd82295, `wip/prepare-saved-page` b90a7a9, `wip/ikea-plant-sizes` e6df289, `wip/cover-relief-engine` 0f96f06, `wip/cover-editor-ui` e4af205, `wip/snapshot-justified` a4d09eb, `wip/neural-voices-integrated` 95ca80a.

## Cola (en este orden, uno a uno)
1. **Voces neuronales (Piper, sin conexión)** — `wip/neural-voices-integrated` (95ca80a) = motor + integración unidos y con correcciones. Faltaba: revisión adversarial (3 revisores) y correcciones, luego subir a `main`. Ramas de origen: `wip/neural-voices-engine`, `wip/neural-voices-integration`.
2. **Papelera: congelación de ~5 s y texto "retirado de la estantería"** — sin código todavía. Plan: perfilar `removeBookInTrash()` (bookshelf.js ~1100) + `removeBookFromShelf()` (app.js ~215): sospecha de `render()` reconstruyendo la escena y de esperar persistencia pesada; el aviso es `trashStatus` (`.ihr-trash-status`): dejarlo solo para lector de pantalla, el error sigue visible.
3. **Controles del lector sin cambiar el nº de líneas** — `wip/reader-controls-stable-layout`. Idea: en modo foco reservar siempre el margen de cabecera y barra (visibility/opacity en vez de display:none / `hidden` + variables `--reader-bar-height`).
4. **Página 3D al abrir, justificada** — `wip/snapshot-justified` (implementado, sin revisar). El snapshot (`page-snapshot.js`) dibujaba cada línea con `fillText` a espaciado natural; ahora cada palabra en su posición medida.
5. **Preparar la última página al sacar el libro** — `wip/prepare-saved-page`. Mover restaurar posición + snapshot + texturas a la fase de preparación (`prepareBookOpen` en app.js), con clave de validez.
6. **Macetas y plantas con tamaño IKEA real** — `wip/ikea-plant-sizes`. Una tabla única en cm (`plant-dimensions.js`), migrar plantas guardadas, comprobar holgura por tipo de estantería. Las páginas de IKEA no son accesibles desde el sandbox: los números son de memoria y deben revisarse.
7. **Editor de portada con relieve** — `wip/cover-relief-engine` (motor: análisis de la portada, mapas, material, persistencia `coverRelief`) y `wip/cover-editor-ui` (pestañas Lomo/Portada, giro animado, 3 tarjetas, balanceo). Contrato: `src/js/cover-relief.js` (la versión del motor sustituye al stub de la UI).

## Notas técnicas que conviene recordar
- Voces: Kokoro es ~4x más lento que el audio en WASM de un solo hilo; sherpa-onnx necesita parches frágiles; Piper (onnxruntime-web + piper_phonemize, modelos de Hugging Face, ~63 MB por voz) mide ~0,45 s por segundo de audio. Las URL de Hugging Face no se pudieron probar desde el sandbox (bloqueadas); los tests las simulan con los modelos locales.
- Android: la app es un WebView que carga el sitio de GitHub Pages, así que los cambios web llegan al desplegar; el 120 Hz nativo necesita publicar un APK nuevo a mano (versión 1.1.2).
- Máquina de pruebas: 4 núcleos con GPU por software; no lanzar varios paquetes pesados a la vez (la carga llegó a 18 y los tests se agotan por tiempo).

## Actualización final de la sesión (2026-10-02, ~16:05 UTC)
**Ya en `main` (desplegado):** resaltado de frases (b4dd143); controles sin reflow 1.7.1, página preparada 1.7.2, tamaños IKEA 1.7.3 y editor de portada con relieve 1.7.4 (todo de ChatGPT); voces neuronales Piper (e6bc309, verificadas: 1309 unitarias, 54 e2e de voz/lector pasan); cobertura de relieve en perezoso para que los libros sin relieve no paguen el shader pesado en el vuelo de apertura/cierre (e407b44).
**Pendiente:**
- Papelera (congelación ~5 s + texto "retirado"): `wip/trash-freeze` (da4a581), sin terminar ni revisar.
- Justificación de la página 3D: `wip/snapshot-justified` (a4d09eb), implementada, sin revisar (mezclar con `main`).
- Estanterías a medidas reales (ambas 60×25×116 cm, BAGGEBO como referencia, libros/lámparas a escala real): `wip/shelf-real-scale` (3ed5fe6), apenas empezada.
- "El 8 no funciona" (página preparada 1.7.2): no se pudo reproducir en el sandbox (GL por software). Los smoke `155`, `391`, `420` de `tests/e2e/smoke.spec.mjs` fallan también en b4dd143 con una espera de 20 s a `is-closing-reader`: es lentitud de SwiftShader, no una regresión. Hay que probar la línea de tiempo (`markTiming`: engine-opened, page-restored, page-snapshot, page-reused) en un navegador con GPU real.
- Android 120 Hz: publicar a mano el APK 1.1.2.
