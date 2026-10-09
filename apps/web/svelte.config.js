import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    // Every page renders in the browser; the game server serves build/ with index.html as the fallback.
    adapter: adapter({ fallback: 'index.html' }),
  },
};

export default config;
