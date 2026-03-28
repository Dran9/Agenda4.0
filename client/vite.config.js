import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Short hash suffix busts LiteSpeed proxy cache on each deploy
        entryFileNames: 'assets/app-[hash:8].js',
        chunkFileNames: 'assets/[name]-[hash:8].js',
        assetFileNames: 'assets/[name]-[hash:8][extname]',
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
