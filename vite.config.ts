import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/three')) return 'three';
          if (id.includes('rapier3d-compat')) return 'rapier';
          return undefined;
        },
      },
    },
  },
  server: { port: 5173 },
});
