import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Fixed filenames — no hashes. Hostinger's deploy doesn't handle
        // git delete+create (hashed names) but DOES handle overwrites.
        entryFileNames: 'assets/app.js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'https://tumvp.in',
        changeOrigin: true,
      },
    },
  },
});
