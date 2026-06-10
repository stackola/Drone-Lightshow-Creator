import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    // three.js alone is ~670 kB minified — that's the floor for this app.
    // The warning still fires above this threshold for *our* code.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // Split heavy vendor libraries into their own chunks so the main
        // app bundle stays under Vite's 500 kB warning and the browser can
        // cache the (rarely-changing) three.js + R3F stack independently
        // of the app code.
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('/three/') || id.includes('\\three\\')) return 'three'
          if (id.includes('@react-three/') || id.includes('postprocessing')) return 'r3f'
          if (id.includes('@xyflow/')) return 'flow'
          if (id.includes('react-dom') || id.includes('/react/')) return 'react'
          if (id.includes('zustand') || id.includes('immer')) return 'state'
          if (id.includes('lucide-react')) return 'icons'
        },
      },
    },
  },
})
