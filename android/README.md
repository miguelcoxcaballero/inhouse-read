# Android

Mismo patrón que **inhouse notes**: la app Android no empaqueta la web offline, es un **WebView-shell** que redirige de inmediato a la versión en vivo de GitHub Pages (`app-loader.html`, en esta misma carpeta). Así un único sitio publicado sirve tanto al navegador como a la app instalada, sin tener que recompilar un APK cada vez que cambia el front-end.

## Por qué no hay aquí un proyecto Android Studio ni una APK ya firmada

inhouse notes genera su APK con una herramienta propia (`android app/html_to_apk_builder.py`, una GUI de Python/Tkinter que crea el proyecto Capacitor, parchea `AndroidManifest.xml`/`MainActivity`, genera los iconos adaptativos y firma el release) y la publica vía un workflow de CI (`build-android.yml`) que lee la clave de firma desde secrets del repo (`INHOUSE_ANDROID_KEYSTORE_BASE64`, etc.).

Ese *keystore* de firma no existe para este proyecto nuevo, y generarlo — y decidir dónde y cómo guardar su contraseña — es una decisión de seguridad que te corresponde a ti, no algo que deba crear yo de forma autónoma. Por eso este repo trae la misma arquitectura (loader-splash + WebView) pero **no** un pipeline de firma automatizado. La entrega principal pedida — la URL pública para abrir/instalar la app — funciona igual sin esto: GitHub Pages ya sirve una PWA instalable desde el navegador (ver más abajo).

## Cómo instalar hoy, sin compilar nada

Desde Chrome/Edge en Android, al abrir la URL de GitHub Pages aparece la opción **"Añadir a pantalla de inicio" / "Instalar app"**: al ser una PWA (manifest + service worker no necesarios para esto, basta con el `<meta name="theme-color">` y el diseño responsive ya incluidos), se instala como un icono normal y abre en modo standalone, sin barra de navegador. Es el camino más rápido y no requiere firma ni Play Store.

## Cómo generar tú mismo un APK (manual, con Capacitor)

```bash
npm install -D @capacitor/core @capacitor/cli @capacitor/android
npx cap init "Inhouse Read" com.inhousesoftware.read --web-dir android/www
mkdir -p android/www && cp android/app-loader.html android/www/index.html
npx cap add android
npx cap sync android
npx cap open android   # abre Android Studio; Build > Generate Signed Bundle/APK
```

Antes de compilar, edita `LIVE_URL` en `app-loader.html` si despliegas bajo otra URL, y en Android Studio crea (o reutiliza) tu propio keystore de firma — Capacitor/Android Studio te lo pedirá en el asistente de "Generate Signed Bundle/APK".

Si más adelante quieres el mismo pipeline automatizado que inhouse notes (firma vía CI, publicación como GitHub Release), el patrón a replicar es `.github/workflows/build-android.yml` de ese repo — pero necesita que primero generes y subas tu propio keystore como secret.
