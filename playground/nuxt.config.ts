export default defineNuxtConfig({
  modules: ['../src/module'],
  devtools: { enabled: true },
  compatibilityDate: '2026-06-29',
  app: {
    head: {
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    },
  },
  cloudflaredTunnel: {
    // Also tunnel a Storybook dev server on :6006. Only enabled when Storybook
    // is actually running alongside Nuxt (use `pnpm dev:all`, which sets
    // CLOUDFLARED_STORYBOOK=1), so plain `pnpm dev` never targets an idle port.
    storybook: Boolean(process.env.CLOUDFLARED_STORYBOOK),
  },
})
