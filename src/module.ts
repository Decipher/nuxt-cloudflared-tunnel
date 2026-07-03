import { defineNuxtModule, createResolver, addPlugin } from '@nuxt/kit'
import { startTunnel } from 'untun'
import { waitForPort } from './wait-for-port'

export interface TunnelTarget {
  /** TCP port to tunnel. */
  port: number
  /** Label shown in console output. */
  label: string
  /** Delay in ms before starting this tunnel (useful for secondary services). */
  delay?: number
  /**
   * When `true`, probe the port before starting this tunnel: open the tunnel
   * as soon as the port is reachable, or skip it (with a log line) if nothing
   * binds within the `delay` (default 5s). Inherits from the module-level
   * `checkPorts` option when unset. The primary Nuxt tunnel is never gated.
   */
  checkPort?: boolean
}

/** Internal target, carrying a marker for the primary Nuxt tunnel. */
interface ResolvedTarget extends TunnelTarget {
  _primary?: boolean
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
  /**
   * When `true`, secondary tunnel targets (the `storybook` shorthand and any
   * entry in `tunnels`) are probed before their tunnel starts: the tunnel
   * opens as soon as the port is reachable, or is skipped if nothing ever
   * binds within the target's `delay` (default 5s). The primary Nuxt tunnel is
   * never gated. Default: `false` (legacy behaviour - open the tunnel
   * regardless of whether the port is up).
   */
  checkPorts?: boolean
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
    checkPorts: false,
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
    const targets: ResolvedTarget[] = []

    // Primary Nuxt tunnel (never port-checked: the listen hook guarantees it)
    targets.push({
      port: options.port ?? 0, // 0 = auto-detect at listen time
      label: 'Nuxt',
      _primary: true,
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

        // The primary Nuxt target is guaranteed to be listening (the hook
        // fired), so it is never port-checked. Secondary targets opt in via
        // the per-target `checkPort` flag, falling back to the module-level
        // `checkPorts` option (default: false = legacy behaviour).
        const shouldCheckPort
          = !target._primary
            && (target.checkPort ?? options.checkPorts ?? false)

        if (shouldCheckPort) {
          // Wait for the port to come up instead of sleeping for a fixed
          // delay: open the tunnel as soon as the service is reachable, or
          // skip it (with a log line) if nothing ever binds within the timeout.
          const timeout = target.delay ?? 5_000
          waitForPort(port, { timeout }).then((up) => {
            if (up) {
              run()
            }
            else if (options.log) {
              console.log(
                `⏭️ Skipping ${target.label} tunnel - nothing listening on :${port}`,
              )
            }
          })
        }
        else if (target.delay) {
          setTimeout(run, target.delay)
        }
        else {
          await run()
        }
      }
    })
  },
})
