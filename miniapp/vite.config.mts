import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import zaloMiniApp from 'zmp-vite-plugin';

export default defineConfig({
  base: './',
  plugins: [zaloMiniApp(), react()],
  build: { outDir: 'www', assetsInlineLimit: 0, target: 'es2018', sourcemap: false },
  server: { host: '127.0.0.1', port: 4930, strictPort: true },
  preview: { host: '127.0.0.1', port: 4930, strictPort: true },
});
