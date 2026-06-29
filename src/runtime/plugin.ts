import { defineNuxtPlugin, useRuntimeConfig } from '#app'

export default defineNuxtPlugin((nuxtApp) => {
  // On the server: process.env is shared across all VM contexts in the same
  // Node.js process. globalThis is NOT shared between the Nuxt module context
  // and Nitro's SSR module runner in Nuxt 4 / Vite 7, so we use process.env.
  // On the client: read from the already-populated SSR payload instead.
  if (import.meta.server) {
    nuxtApp.payload.cloudflaredTunnelUrl = process.env.__CLOUDFLARED_TUNNEL_URL
  }

  const tunnelUrl = (nuxtApp.payload as Record<string, unknown>).cloudflaredTunnelUrl as string | undefined

  // runtimeConfig is snapshotted before the listen hook fires, so patch it
  // per-request so useRuntimeConfig().public.cloudflaredTunnelUrl works.
  const config = useRuntimeConfig()
  ;(config.public as Record<string, unknown>).cloudflaredTunnelUrl = tunnelUrl

  return {
    provide: {
      tunnelUrl,
      isTunnel: !!tunnelUrl,
    },
  }
})
