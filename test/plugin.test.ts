/**
 * Plugin unit tests.
 *
 * Vitest runs in Node.js where `import.meta.server` is `false`, so these tests
 * exercise the client-side path (reading from `nuxtApp.payload`).  The server-
 * side path (writing `process.env.__CLOUDFLARED_TUNNEL_URL` into the payload)
 * is a trivial one-liner covered by the integration layer.
 *
 * The tests here guard against the original regression: the plugin must read
 * from the SSR-hydrated `nuxtApp.payload`, not from a process-global that is
 * unavailable in the browser.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

type PluginFn = (nuxtApp: {
  payload: Record<string, unknown>
}) => { provide: Record<string, unknown> }

function makeApp(payloadOverrides: Record<string, unknown> = {}) {
  return { payload: { ...payloadOverrides } }
}

describe('runtime plugin (client path)', () => {
  beforeEach(() => {
    vi.resetModules()
    delete process.env.__CLOUDFLARED_TUNNEL_URL
  })

  it('provides the tunnel URL from a pre-populated payload (SSR hydration)', async () => {
    vi.doMock('#app', () => ({
      defineNuxtPlugin: (fn: PluginFn) => fn,
      useRuntimeConfig: () => ({ public: {} as Record<string, unknown> }),
    }))

    const { default: plugin } = await import('../src/runtime/plugin')
    const app = makeApp({ cloudflaredTunnelUrl: 'https://example.trycloudflare.com' })
    const result = (plugin as unknown as PluginFn)(app)

    expect(result.provide.tunnelUrl).toBe('https://example.trycloudflare.com')
    expect(result.provide.isTunnel).toBe(true)
  })

  it('provides undefined / isTunnel=false when the payload has no URL', async () => {
    vi.doMock('#app', () => ({
      defineNuxtPlugin: (fn: PluginFn) => fn,
      useRuntimeConfig: () => ({ public: {} as Record<string, unknown> }),
    }))

    const { default: plugin } = await import('../src/runtime/plugin')
    const result = (plugin as unknown as PluginFn)(makeApp())

    expect(result.provide.tunnelUrl).toBeUndefined()
    expect(result.provide.isTunnel).toBe(false)
  })

  it('does NOT read process.env directly on the client path (original regression)', async () => {
    // Even if process.env has the URL (server set it), the client path must read
    // from nuxtApp.payload (the SSR-hydrated value), not from process.env which
    // is unavailable in the browser build.
    process.env.__CLOUDFLARED_TUNNEL_URL = 'https://should-not-appear.trycloudflare.com'

    vi.doMock('#app', () => ({
      defineNuxtPlugin: (fn: PluginFn) => fn,
      useRuntimeConfig: () => ({ public: {} as Record<string, unknown> }),
    }))

    const { default: plugin } = await import('../src/runtime/plugin')
    // Payload is empty — the client received no SSR payload (or the server had
    // no tunnel running at render time)
    const result = (plugin as unknown as PluginFn)(makeApp())

    expect(result.provide.tunnelUrl).toBeUndefined()
    expect(result.provide.isTunnel).toBe(false)
  })

  it('patches useRuntimeConfig().public.cloudflaredTunnelUrl', async () => {
    const publicConfig: Record<string, unknown> = {}
    vi.doMock('#app', () => ({
      defineNuxtPlugin: (fn: PluginFn) => fn,
      useRuntimeConfig: () => ({ public: publicConfig }),
    }))

    const { default: plugin } = await import('../src/runtime/plugin')
    ;(plugin as unknown as PluginFn)(
      makeApp({ cloudflaredTunnelUrl: 'https://example.trycloudflare.com' }),
    )

    expect(publicConfig.cloudflaredTunnelUrl).toBe('https://example.trycloudflare.com')
  })
})
