import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: process.env.PUBLIC_SITE_URL || 'https://bj-burgers-web.pages.dev',
  output: 'static',
  integrations: [react(), sitemap()],
  vite: {
    envPrefix: ['PUBLIC_'],
  },
});
