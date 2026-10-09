import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

// The game server; API calls and the Socket.IO connection are proxied to it in development.
const gameServer = process.env.GAME_SERVER_URL ?? 'http://localhost:3001';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': gameServer,
      '/socket.io': { target: gameServer, ws: true },
    },
  },
});
