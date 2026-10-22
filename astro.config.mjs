import { defineConfig } from 'astro/config';

// Sitio 100 % estático: se despliega gratis en Vercel, Netlify o Cloudflare Pages.
export default defineConfig({
  vite: {
    // three.js ocupa ~600 kB minificado (~150 kB gzip); no es un problema para esta página.
    build: { chunkSizeWarningLimit: 800 },
    // Pre-empaqueta los addons de three.js en desarrollo: agregar uno nuevo no traba el
    // servidor con "504 Outdated Optimize Dep".
    optimizeDeps: {
      include: [
        'three',
        'three/addons/loaders/GLTFLoader.js',
        'three/addons/environments/RoomEnvironment.js',
        'three/addons/geometries/RoundedBoxGeometry.js',
        'three/addons/postprocessing/EffectComposer.js',
        'three/addons/postprocessing/RenderPass.js',
        'three/addons/postprocessing/UnrealBloomPass.js',
        'three/addons/postprocessing/OutputPass.js',
        'qrcode', // la pantalla del QR (/qr): sin esto, tras reiniciar el servidor puede no cargar al primer intento
      ],
    },
  },
});
