import { defineNuxtPlugin, useRuntimeConfig } from '#app'

export default defineNuxtPlugin(() => {
  // Plugin can be used to expose tunnel URL or handle tunnel-specific logic
  const tunnelUrl = useRuntimeConfig().public.cloudflaredTunnelUrl

  return {
    provide: {
      tunnelUrl,
      isTunnel: !!tunnelUrl,
    },
  }
})
