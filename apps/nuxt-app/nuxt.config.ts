// https://nuxt.com/docs/api/configuration/nuxt-config

/**
 * Runs before first paint: resolves the persisted theme so there is no flash of the wrong theme.
 * Kept tiny and dependency-free on purpose.
 */
const themeBootScript = `(function(){try{var t='system';var raw=localStorage.getItem('taskpilot:v2')||localStorage.getItem('taskpilot:v1');if(raw){var s=JSON.parse(raw);if(s&&s.settings&&s.settings.theme)t=s.settings.theme;}var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);var e=document.documentElement;e.dataset.theme=d?'dark':'light';e.style.colorScheme=d?'dark':'light';}catch(_){}})();`;

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: false },
  modules: ['@pinia/nuxt', '@nuxt/eslint'],
  css: ['~/assets/css/main.css'],
  typescript: { strict: true },
  app: {
    head: {
      htmlAttrs: { lang: 'en' },
      title: 'TaskPilot',
      meta: [
        { name: 'description', content: 'TaskPilot – plan, track and finish your work.' },
        { name: 'theme-color', content: '#4f46e5' },
      ],
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
      script: [{ innerHTML: themeBootScript, tagPosition: 'head' }],
    },
  },
  eslint: { config: { stylistic: false } },
  // Serve pre-compressed (gzip + brotli) static assets; HTML is compressed by server/plugins/compression.ts.
  nitro: { compressPublicAssets: true },
});
