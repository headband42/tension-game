import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// Use environment variable or default to localhost
const API_URL = 'http://localhost:3001';

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    port: 5173,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: API_URL,
        changeOrigin: true,
      }
    }
  }
});
