// Astro 7 static build for GitHub-connected Cloudflare Pages.
// Dynamic endpoints live in the Pages Functions directory (/functions).
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  output: 'static',
  vite: {
    plugins: [tailwindcss()],
  },
});
