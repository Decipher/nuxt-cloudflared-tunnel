import { defineNuxtModule, createResolver, addPlugin } from '@nuxt/kit'
import { startTunnel } from 'untun'
import { createConnection } from 'node:net'
import type { StorybookProxyOptions } from './storybook-proxy'

export interface StorybookTunnelOptions {
  /**
   * Enable Storybook tunneling. Set to `'auto'` (default) to detect at startup
   * whether a Storybook dev server is running.
   */
  enabled?: boolean | 'auto'
  /**
   * Tunnel mode.
   *
   * - `'auto'` (default): if a Storybook server is detected on `port`,
   *   opens a separate Quick Tunnel (`dual-tunnel`). If not detected, skips
   *   Storybook tunneling and logs a hint.
   * - `'dual-tunnel'`: always opens a separate Quick Tunnel for Storybook.
   *   Requires Storybook to be running separately (`mise run storybook`).
   * - `'proxy'`: Nuxt reverse-proxies `/_storybook/` to the Storybook dev
   *   server through a single tunnel. Requires Storybook to be running
   *   separately.
   */
  mode?: 'auto' | 'dual-tunnel' | 'proxy'
  /** Storybook dev server port. Default: `6006`. */
  port?: number
  /** Proxy route prefix (proxy mode only). Default: `'/_storybook'`. */
  prefix?: string
}

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
  /** Extra services to tunnel. */
  tunnels?: TunnelTarget[]
  /** Storybook integration configuration. */
  storybook?: StorybookTunnelOptions
}

/**
 * Check whether a TCP port is accepting connections.
 *
 * @param port - Port to probe.
 * @param host - Host to connect to. Default `'localhost'`.
 * @param timeout - Connection timeout in ms. Default `500`.
 * @returns `true` if the port is reachable.
 */
function isPortOpen(port: number, host = 'localhost', timeout = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host })
    const timer = setTimeout(() => {
      socket.destroy()
      resolve(false)
    }, timeout)

    socket.once('connect', () => {
      clearTimeout(timer)
      socket.destroy()
      resolve(true)
    })

    socket.once('error', () => {
      clearTimeout(timer)
      resolve(false)
    })
  })
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
    tunnels: [],
    storybook: {
      enabled: 'auto',
      mode: 'auto',
    },
  },
  async setup(options, nuxt) {
    const resolver = createResolver(import.meta.url)

    // Only run in development
    if (!options.enabled || nuxt.options.dev === false) {
      return
    }

    addPlugin(resolver.resolve('./runtime/plugin'))

    // --- Storybook config ---
    const storybookOpts = options.storybook
    const sbConfig = (nuxt.options as unknown as Record<string, { port?: number } | undefined>).storybook
    const storybookPort
      = storybookOpts?.port ?? sbConfig?.port ?? 6006

    // --- Resolve Storybook enabled/mode ---
    const storybookEnabled = storybookOpts?.enabled ?? 'auto'
    const storybookMode = storybookOpts?.mode ?? 'auto'

    // Determine effective mode
    let effectiveMode: 'dual-tunnel' | 'proxy' | 'none'

    if (storybookEnabled === false) {
      // Explicitly disabled — skip Storybook entirely
      effectiveMode = 'none'
    } else if (storybookEnabled === true) {
      // Explicitly enabled — use configured mode (auto resolves to dual-tunnel)
      effectiveMode = storybookMode === 'auto' ? 'dual-tunnel' : storybookMode
    } else {
      // Auto mode — detect at startup whether Storybook is running
      const storybookRunning = await isPortOpen(storybookPort)

      if (storybookRunning) {
        effectiveMode = storybookMode === 'proxy' ? 'proxy' : 'dual-tunnel'
        if (options.log) {
          console.log(
            `📖 Storybook detected on :${storybookPort}, opening dual tunnel.`,
          )
        }
      } else {
        effectiveMode = 'none'
        if (options.log) {
          console.log(
            `💡 Storybook not detected on :${storybookPort}. `
            + `Run \`mise run storybook\` in another terminal to enable Storybook tunneling.`,
          )
        }
      }
    }

    // --- Proxy mode: inject Vite middleware plugin ---
    if (effectiveMode === 'proxy') {
      const prefix = storybookOpts?.prefix ?? '/_storybook'

      const proxyOptions: StorybookProxyOptions = {
        port: storybookPort,
        prefix,
        log: options.log,
      }

      // Dynamic import to avoid loading storybook-proxy during typecheck/generate
      const { storybookProxyPlugin } = await import('./storybook-proxy')

      nuxt.hook('vite:extendConfig', (config) => {
        ;(config.plugins as unknown[]).push(storybookProxyPlugin(proxyOptions))
      })

      if (options.log) {
        console.log(
          `📖 Storybook proxy mode: ${prefix}/ -> localhost:${storybookPort}`,
        )
      }
    }

    // --- Determine tunnel targets ---
    const targets: TunnelTarget[] = []

    // Primary Nuxt tunnel
    targets.push({
      port: options.port ?? 0, // 0 = auto-detect at listen time
      label: 'Nuxt',
    })

    // Storybook dual-tunnel mode
    if (effectiveMode === 'dual-tunnel') {
      targets.push({
        port: storybookPort,
        label: 'Storybook',
        delay: 5_000, // Give Storybook time to boot after Nuxt
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

            // Expose tunnel URL to runtime (primary only)
            if (target.label === 'Nuxt') {
              nuxt.options.runtimeConfig.public.cloudflaredTunnelUrl
                = tunnelUrl

              if (effectiveMode === 'proxy') {
                const prefix = storybookOpts?.prefix ?? '/_storybook'
                if (options.log) {
                  console.log(
                    `📖 Storybook available at: ${tunnelUrl}${prefix}/`,
                  )
                }
              }
            }
          } catch (error) {
            console.error(
              `Failed to start Cloudflare tunnel for ${target.label}:`,
              error,
            )
          }
        }

        if (target.delay) {
          setTimeout(run, target.delay)
        } else {
          await run()
        }
      }
    })
  },
})
