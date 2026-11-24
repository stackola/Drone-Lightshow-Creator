import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  worker: { format: 'es' },
  build: {
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('/three/')) return 'three'
          if (id.includes('@react-three/')) return 'r3f'
          if (id.includes('react-dom') || id.includes('/react/')) return 'react'
        },
      },
    },
  },
})
