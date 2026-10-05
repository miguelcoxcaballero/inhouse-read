import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import { foliateFixedLayoutPatch } from './scripts/foliate-fixed-layout-patch.mjs'
import { foliateBackgroundPatch } from './scripts/foliate-background-patch.mjs'
import { foliateArchivePatch } from './scripts/foliate-archive-patch.mjs'
import { pdfBackgroundPatch } from './scripts/pdf-background-patch.mjs'
import { neuralVoiceAssets } from './scripts/neural-voice-assets.mjs'
import { shelfBakeVersion } from './scripts/shelf-bake-version.mjs'

const resolvePath = p => fileURLToPath(new URL(p, import.meta.url))

// GitHub Pages sirve el proyecto bajo /inhouse-read/, no en la raíz del dominio.
export default defineConfig({
  base: '/inhouse-read/',
  plugins:[foliateFixedLayoutPatch(), foliateBackgroundPatch(), foliateArchivePatch(), pdfBackgroundPatch(), neuralVoiceAssets(),
    shelfBakeVersion(resolvePath('.'))],
  // Keep the same guarded source in development as in production; otherwise
  // dependency prebundling would bypass the fixed-layout transform in dev.
  optimizeDeps:{ exclude:['foliate-js', 'pdfjs-dist/legacy/build/pdf.mjs'] },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      // Multi-página: la app en sí (index.html) y la landing de descarga de
      // Android (download-android.html), servida como página real del
      // sitio en vez de solo enlazar directo al asset de un Release.
      input: {
        main: resolvePath('./index.html'),
        androidDownload: resolvePath('./download-android.html')
      },
      output: {
        // three.js (~530 KB) changes only when it is upgraded: its own file
        // keeps its hash across releases, so an update re-downloads the app
        // code only, and the browser compiles both files in parallel.
        manualChunks: id => /node_modules[\\/]three[\\/]build[\\/]/.test(id) ? 'three' : undefined
      }
    }
  },
  server: {
    port: 5173
  }
})
