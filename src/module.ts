import { defineNuxtModule, createResolver, addPlugin } from '@nuxt/kit'
import { startTunnel } from 'untun'

export interface TunnelTarget {
  /** TCP port to tunnel. */
  port: number
  /** Label shown in console output. */
  label: string
  /** Delay in ms before starting this tunnel (useful for secondary services). */
  delay?: number
}

export interface ModuleOptions {
  enabled?: boolean
  port?: number
  log?: boolean
  /**
   * Shorthand to tunnel a Storybook dev server on port 6006.
   * Set to `true` to add it as a tunnel target with a 5s startup delay.
   */
  storybook?: boolean
  /** Extra services to tunnel alongside the Nuxt dev server. */
  tunnels?: TunnelTarget[]
}

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: 'nuxt-cloudflared-tunnel',
    configKey: 'cloudflaredTunnel',
  },
  defaults: {
    enabled: true,
    port: undefined,
    log: true,
    storybook: false,
    tunnels: [],
  },
  async setup(options, nuxt) {
    const resolver = createResolver(import.meta.url)

    // Only run in development
    if (!options.enabled || nuxt.options.dev === false) {
      return
    }

    addPlugin(resolver.resolve('./runtime/plugin'))

    // --- Determine tunnel targets ---
    const targets: TunnelTarget[] = []

    // Primary Nuxt tunnel
    targets.push({
      port: options.port ?? 0, // 0 = auto-detect at listen time
      label: 'Nuxt',
    })

    // Storybook shorthand
    if (options.storybook) {
      targets.push({
        port: 6006,
        label: 'Storybook',
        delay: 5_000,
      })
    }

    // User-defined extra tunnels
    for (const t of options.tunnels ?? []) {
      targets.push(t)
    }

    // Start tunnels after server is ready
    nuxt.hook('listen', async (server) => {
      const address = server.address()
      const nuxtPort
        = typeof address === 'string' ? 3000 : address?.port ?? 3000

      for (const target of targets) {
        const port = target.port || nuxtPort
        const run = async () => {
          if (options.log) {
            console.log(
              `🚇 Starting Cloudflare tunnel for ${target.label} (:${port})...`,
            )
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
              console.log(`🌐 ${target.label} tunnel ready at: ${tunnelUrl}`)
            }

            // Dynamically update Vite's allowedHosts (first tunnel only)
            if (nuxt.options.vite?.server && target.label === 'Nuxt') {
              nuxt.options.vite.server.allowedHosts = true

              if (options.log) {
                console.log(`🔓 Allowed tunnel host: ${tunnelHost}`)
              }
            }

            // Expose tunnel URL to runtime (primary only).
            // runtimeConfig is snapshotted before the listen hook fires and
            // globalThis is not shared between Nuxt's module context and
            // Nitro's SSR module-runner context in Nuxt 4 / Vite 7.
            // process.env is shared across all VM contexts in the same process.
            if (target.label === 'Nuxt') {
              process.env.__CLOUDFLARED_TUNNEL_URL = tunnelUrl
              nuxt.options.runtimeConfig.public.cloudflaredTunnelUrl
                = tunnelUrl
            }
          }
          catch (error) {
            console.error(
              `Failed to start Cloudflare tunnel for ${target.label}:`,
              error,
            )
          }
        }

        if (target.delay) {
          setTimeout(run, target.delay)
        }
        else {
          await run()
        }
      }
    })
  },
})
