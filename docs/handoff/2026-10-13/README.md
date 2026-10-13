# Relevo remoto de Inhouse Read

Este paquete permite continuar desde otro ordenador. **No es una versión
verificada para producción**. La rama `handoff/rust-1.7.235-20261013` conserva
todo el código pendiente de 235, las pruebas y la documentación del relevo.
La web publicada continúa en 234; no se ha creado otra APK ni modificado
ningún catálogo de actualizaciones.

## Recuperar el trabajo

```sh
git clone --branch handoff/rust-1.7.235-20261013 https://github.com/miguelcoxcaballero/inhouse-read.git
cd inhouse-read
```

Leer `docs/agent-handoff-2026-10-13.md`, `docs/remaining-wip-verification.md`,
`docs/rust-migration.md`, `AGENTS.md` y `UPDATER.md`. Consultar después el remoto
para incorporar posibles cambios posteriores sin perder los de esta rama.

## Banco de trabajo

[workbench.zip](workbench.zip) contiene 536 archivos: fuentes y pruebas de los
prototipos de semilla/cola, scripts de benchmark y verificación y resultados
originales, incluidos los fallos. [workbench-manifest.json](workbench-manifest.json)
registra tamaño y SHA-256 del ZIP y de cada archivo. Los archivos de origen no
se han modificado para esta copia.

Extraer en un directorio de evidencia **fuera de las fuentes de producción**.
No ejecutar los scripts de preparación sin revisar sus escrituras: algunos
modifican un checkout. Las rutas `C:/Users/migue/...`, `D:/CodexEvidence/...`,
Android SDK, Cargo, bindgen y el identificador del emulador describen el equipo
original; sustituirlas por las del equipo nuevo. Instalar dependencias con
`npm ci`, respetar el toolchain fijado y reconstruir con los scripts del repo.
No copiar bindings/WASM experimentales a producción. Para voces reales,
revisar los workflows y los mecanismos de descarga de fixtures del proyecto.

Los prototipos de cola son **descartados o pendientes**, no mejoras aprobadas:
resultaron más lentos y uno pierde una referencia. El trabajo integrable de
235 está en `rust-core/src/cover_seed.rs` y sus adaptadores/pruebas del repo.
Build, 50 pruebas focales y 2 E2E pasaron; las unitarias completas fueron
interrumpidas para el relevo. Faltan la batería completa, las regresiones y la
verificación real de una futura publicación. No confundir el log parcial
archivado con una ejecución aprobada.

## CI y artefactos originales accesibles en GitHub

- [CI 234, fallida](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/38427723850).
- [Despliegue 234](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/38427723866).
- [Pages 234](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/38427883697).

El ZIP conserva los logs originales de UI2 y del agregador, los hechos de
cierre, el estado final de CI y los resultados de publicación. Capturas,
traces y reportes completos de CI se pueden recuperar del run original:

```sh
gh run download 38427723850 --repo miguelcoxcaballero/inhouse-read --dir evidence/ci234
```

No se incluyen modelos de voz, APKs, dependencias, keystores, tokens,
almacenamiento de usuario ni volcados del emulador. Los binarios de prueba
incluidos dentro del banco de trabajo son experimentales, no una APK nueva.
Conservar los fallos originales, resolver el cierre pendiente sin debilitar
las pruebas y publicar cambios terminados según la política A del updater.
