import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  build: {
    outDir: 'dist',
    emptyOutDir: true,

    rollupOptions: {
      input: {
        popup: fileURLToPath(
          new URL('./src/popup/index.html', import.meta.url),
        ),
        dashboard: fileURLToPath(
          new URL('./src/dashboard/index.html', import.meta.url),
        ),
        options: fileURLToPath(
          new URL('./src/options/index.html', import.meta.url),
        ),
        background: fileURLToPath(
          new URL('./src/background/index.ts', import.meta.url),
        ),
        content: fileURLToPath(
          new URL('./src/content/index.ts', import.meta.url),
        ),
      },

      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'background') {
            return 'background/index.js'
          }

          if (chunkInfo.name === 'content') {
            return 'content/index.js'
          }

          return 'assets/[name]-[hash].js'
        },

        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
})