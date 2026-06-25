import { defineNuxtModule, createResolver, addPlugin } from '@nuxt/kit'
import { startTunnel } from 'untun'

export interface ModuleOptions {
  enabled?: boolean
  port?: number
  log?: boolean
}

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: 'nuxt-cloudflared-tunnel',
    configKey: 'cloudflaredTunnel',
  },
  defaults: {
    enabled: true,
    port: undefined, // Auto-detect from Nuxt
    log: true,
  },
  async setup(options, nuxt) {
    const resolver = createResolver(import.meta.url)

    // Only run in development
    if (!options.enabled || nuxt.options.dev === false) {
      return
    }

    addPlugin(resolver.resolve('./runtime/plugin'))

    // Start tunnel after server is ready
    nuxt.hook('listen', async (server) => {
      const address = server.address()

      // Determine the port
      const port = options.port || (typeof address === 'string' ? 3000 : address?.port || 3000)

      if (options.log) {
        console.log('🚇 Starting Cloudflare tunnel...')
      }

      try {
        const tunnel = await startTunnel({
          port,
          acceptCloudflareNotice: true,
        })

        if (!tunnel) {
          throw new Error('untun did not return a tunnel')
        }

        const tunnelUrl = await tunnel.getURL()
        const tunnelHost = tunnelUrl.replace(/^https?:\/\//, '')

        if (options.log) {
          console.log(`🌐 Tunnel ready at: ${tunnelUrl}`)
        }

        // Dynamically update Vite's allowedHosts
        if (nuxt.options.vite?.server) {
          nuxt.options.vite.server.allowedHosts = true

          if (options.log) {
            console.log(`🔓 Allowed tunnel host: ${tunnelHost}`)
          }
        }

        // Expose tunnel URL to runtime
        nuxt.options.runtimeConfig.public.cloudflaredTunnelUrl = tunnelUrl
      } catch (error) {
        console.error('Failed to start Cloudflare tunnel:', error)
      }
    })
  },
})