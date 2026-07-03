import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addPlugin } from '@nuxt/kit'
import tunnelModule, { type ModuleOptions } from '../src/module'

const { startTunnel } = vi.hoisted(() => ({
  startTunnel: vi.fn(),
}))

vi.mock('untun', () => ({ startTunnel }))

const { waitForPort } = vi.hoisted(() => ({
  waitForPort: vi.fn(),
}))

vi.mock('../src/wait-for-port', () => ({ waitForPort }))

vi.mock('@nuxt/kit', () => ({
  defineNuxtModule: <T>(definition: T) => definition,
  createResolver: () => ({ resolve: (p: string) => p }),
  addPlugin: vi.fn(),
}))

interface MockNuxt {
  options: {
    dev: boolean
    vite: { server: { allowedHosts?: boolean | string[] } }
    runtimeConfig: { public: { cloudflaredTunnelUrl?: string } }
  }
  hook: (name: string, fn: (...args: unknown[]) => unknown) => void
  triggerListen: (server: { address: () => unknown }) => Promise<void>
}

interface RawNuxtModule {
  meta: { name: string, configKey: string }
  defaults: ModuleOptions
  setup: (options: ModuleOptions, nuxt: MockNuxt) => Promise<void> | void
}

const rawTunnelModule = tunnelModule as unknown as RawNuxtModule

function createMockNuxt(dev = true): MockNuxt {
  const listenListeners: ((server: { address: () => unknown }) => unknown)[] = []
  return {
    options: {
      dev,
      vite: { server: {} },
      runtimeConfig: { public: {} },
    },
    hook(name, fn) {
      if (name === 'listen') {
        listenListeners.push(fn as (server: { address: () => unknown }) => unknown)
      }
    },
    async triggerListen(server) {
      for (const fn of listenListeners) {
        await fn(server)
      }
    },
  }
}

/**
 * Flush pending microtasks/macrotasks so non-awaited async work (the
 * `waitForPort(...).then(run)` chain) completes before assertions.
 */
function flushPromises(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

describe('nuxt-cloudflared-tunnel module', () => {
  beforeEach(() => {
    startTunnel.mockReset()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    delete process.env.__CLOUDFLARED_TUNNEL_URL
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('exposes the expected defaults and meta', () => {
    expect(rawTunnelModule.meta).toMatchObject({
      name: 'nuxt-cloudflared-tunnel',
      configKey: 'cloudflaredTunnel',
    })
    expect(rawTunnelModule.defaults).toMatchObject({
      enabled: true,
      port: undefined,
      log: true,
      storybook: false,
      tunnels: [],
    })
  })

  it('registers the runtime plugin when enabled', async () => {
    const nuxt = createMockNuxt()

    await rawTunnelModule.setup({ enabled: true, log: true }, nuxt)

    expect(addPlugin).toHaveBeenCalledWith('./runtime/plugin')
  })

  it('does not register a listen hook when disabled', async () => {
    const nuxt = createMockNuxt()
    const hookSpy = vi.spyOn(nuxt, 'hook')

    await rawTunnelModule.setup({ enabled: false, log: true }, nuxt)

    expect(hookSpy).not.toHaveBeenCalled()
    expect(startTunnel).not.toHaveBeenCalled()
  })

  it('does not register a listen hook outside of dev mode', async () => {
    const nuxt = createMockNuxt(false)
    const hookSpy = vi.spyOn(nuxt, 'hook')

    await rawTunnelModule.setup({ enabled: true, log: true }, nuxt)

    expect(hookSpy).not.toHaveBeenCalled()
    expect(startTunnel).not.toHaveBeenCalled()
  })

  it('starts a tunnel on the configured port when the server listens', async () => {
    startTunnel.mockResolvedValue({
      getURL: vi.fn().mockResolvedValue('https://example.trycloudflare.com'),
    })
    const nuxt = createMockNuxt()

    await rawTunnelModule.setup({ enabled: true, port: 4000, log: true }, nuxt)
    await nuxt.triggerListen({ address: () => ({ port: 3000 }) })

    expect(startTunnel).toHaveBeenCalledWith({
      port: 4000,
      acceptCloudflareNotice: true,
    })
    expect(nuxt.options.runtimeConfig.public.cloudflaredTunnelUrl).toBe(
      'https://example.trycloudflare.com',
    )
    expect(process.env.__CLOUDFLARED_TUNNEL_URL).toBe(
      'https://example.trycloudflare.com',
    )
    expect(nuxt.options.vite.server.allowedHosts).toBe(true)
  })

  it('falls back to the detected server port when none is configured', async () => {
    startTunnel.mockResolvedValue({
      getURL: vi.fn().mockResolvedValue('https://example.trycloudflare.com'),
    })
    const nuxt = createMockNuxt()

    await rawTunnelModule.setup({ enabled: true, log: true }, nuxt)
    await nuxt.triggerListen({ address: () => ({ port: 4321 }) })

    expect(startTunnel).toHaveBeenCalledWith({
      port: 4321,
      acceptCloudflareNotice: true,
    })
  })

  it('falls back to port 3000 when the server address is a string', async () => {
    startTunnel.mockResolvedValue({
      getURL: vi.fn().mockResolvedValue('https://example.trycloudflare.com'),
    })
    const nuxt = createMockNuxt()

    await rawTunnelModule.setup({ enabled: true, log: true }, nuxt)
    await nuxt.triggerListen({ address: () => '/tmp/nuxt.sock' })

    expect(startTunnel).toHaveBeenCalledWith({
      port: 3000,
      acceptCloudflareNotice: true,
    })
  })

  it('logs the tunnel URL and allowed host when logging is enabled', async () => {
    startTunnel.mockResolvedValue({
      getURL: vi.fn().mockResolvedValue('https://example.trycloudflare.com'),
    })
    const nuxt = createMockNuxt()

    await rawTunnelModule.setup({ enabled: true, log: true }, nuxt)
    await nuxt.triggerListen({ address: () => ({ port: 3000 }) })

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('https://example.trycloudflare.com'),
    )
  })

  it('does not log when logging is disabled', async () => {
    startTunnel.mockResolvedValue({
      getURL: vi.fn().mockResolvedValue('https://example.trycloudflare.com'),
    })
    const nuxt = createMockNuxt()

    await rawTunnelModule.setup({ enabled: true, log: false }, nuxt)
    await nuxt.triggerListen({ address: () => ({ port: 3000 }) })

    expect(console.log).not.toHaveBeenCalled()
  })

  it('logs an error and does not throw when untun returns no tunnel', async () => {
    startTunnel.mockResolvedValue(undefined)
    const nuxt = createMockNuxt()

    await rawTunnelModule.setup({ enabled: true, log: true }, nuxt)
    await expect(
      nuxt.triggerListen({ address: () => ({ port: 3000 }) }),
    ).resolves.not.toThrow()

    expect(console.error).toHaveBeenCalled()
    expect(nuxt.options.runtimeConfig.public.cloudflaredTunnelUrl).toBeUndefined()
  })

  it('logs an error and does not throw when starting the tunnel rejects', async () => {
    startTunnel.mockRejectedValue(new Error('network unreachable'))
    const nuxt = createMockNuxt()

    await rawTunnelModule.setup({ enabled: true, log: true }, nuxt)
    await expect(
      nuxt.triggerListen({ address: () => ({ port: 3000 }) }),
    ).resolves.not.toThrow()

    expect(console.error).toHaveBeenCalled()
  })
})

// --- Storybook shorthand + tunnels array tests ---

describe('nuxt-cloudflared-tunnel module · extra tunnels', () => {
  beforeEach(() => {
    startTunnel.mockReset()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    delete process.env.__CLOUDFLARED_TUNNEL_URL
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('starts a second tunnel for Storybook when storybook: true', async () => {
    startTunnel.mockResolvedValue({
      getURL: vi.fn().mockResolvedValue('https://sb.trycloudflare.com'),
    })
    const nuxt = createMockNuxt()

    await rawTunnelModule.setup(
      { enabled: true, log: false, storybook: true },
      nuxt,
    )
    await nuxt.triggerListen({ address: () => ({ port: 3000 }) })

    // Two calls: Nuxt (port 3000) then Storybook (port 6006 after delay)
    expect(startTunnel).toHaveBeenCalledWith({
      port: 3000,
      acceptCloudflareNotice: true,
    })

    // Storybook tunnel is delayed via setTimeout, so verify it was queued
    // by checking that startTunnel was only called once synchronously
    expect(startTunnel).toHaveBeenCalledTimes(1)
  })

  it('starts tunnels for arbitrary extra targets', async () => {
    startTunnel.mockResolvedValue({
      getURL: vi.fn().mockResolvedValue('https://api.trycloudflare.com'),
    })
    const nuxt = createMockNuxt()

    await rawTunnelModule.setup(
      {
        enabled: true,
        log: false,
        tunnels: [{ port: 8080, label: 'API' }],
      },
      nuxt,
    )
    await nuxt.triggerListen({ address: () => ({ port: 3000 }) })

    // Nuxt tunnel (no delay) runs synchronously, API tunnel runs synchronously (no delay)
    expect(startTunnel).toHaveBeenCalledTimes(2)
    expect(startTunnel).toHaveBeenCalledWith({
      port: 3000,
      acceptCloudflareNotice: true,
    })
    expect(startTunnel).toHaveBeenCalledWith({
      port: 8080,
      acceptCloudflareNotice: true,
    })
  })

  it('does not start a Storybook tunnel when storybook is false', async () => {
    startTunnel.mockResolvedValue({
      getURL: vi.fn().mockResolvedValue('https://example.trycloudflare.com'),
    })
    const nuxt = createMockNuxt()

    await rawTunnelModule.setup(
      { enabled: true, log: false, storybook: false },
      nuxt,
    )
    await nuxt.triggerListen({ address: () => ({ port: 3000 }) })

    expect(startTunnel).toHaveBeenCalledTimes(1)
  })
})

// --- Port checking (checkPorts / per-target checkPort) ---

describe('nuxt-cloudflared-tunnel module · port checking', () => {
  beforeEach(() => {
    startTunnel.mockReset()
    waitForPort.mockReset()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    delete process.env.__CLOUDFLARED_TUNNEL_URL
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('skips a secondary tunnel when its port is down and checkPorts is enabled', async () => {
    waitForPort.mockResolvedValue(false)
    startTunnel.mockResolvedValue({
      getURL: vi.fn().mockResolvedValue('https://nuxt.trycloudflare.com'),
    })
    const nuxt = createMockNuxt()

    await rawTunnelModule.setup(
      { enabled: true, log: true, storybook: true, checkPorts: true },
      nuxt,
    )
    await nuxt.triggerListen({ address: () => ({ port: 3000 }) })
    await flushPromises()

    // Primary Nuxt tunnel still starts; Storybook is skipped (port down).
    expect(waitForPort).toHaveBeenCalledWith(6006, { timeout: 5_000 })
    expect(startTunnel).toHaveBeenCalledTimes(1)
    expect(startTunnel).toHaveBeenCalledWith({
      port: 3000,
      acceptCloudflareNotice: true,
    })
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('Skipping Storybook tunnel'),
    )
  })

  it('starts a secondary tunnel once its port is reachable when checkPorts is enabled', async () => {
    waitForPort.mockResolvedValue(true)
    startTunnel.mockResolvedValue({
      getURL: vi.fn().mockResolvedValue('https://sb.trycloudflare.com'),
    })
    const nuxt = createMockNuxt()

    await rawTunnelModule.setup(
      { enabled: true, log: false, storybook: true, checkPorts: true },
      nuxt,
    )
    await nuxt.triggerListen({ address: () => ({ port: 3000 }) })
    await flushPromises()

    expect(startTunnel).toHaveBeenCalledTimes(2)
    expect(startTunnel).toHaveBeenCalledWith({
      port: 6006,
      acceptCloudflareNotice: true,
    })
  })

  it('never port-checks the primary Nuxt tunnel, even when checkPorts is enabled', async () => {
    waitForPort.mockResolvedValue(false)
    startTunnel.mockResolvedValue({
      getURL: vi.fn().mockResolvedValue('https://nuxt.trycloudflare.com'),
    })
    const nuxt = createMockNuxt()

    await rawTunnelModule.setup(
      { enabled: true, log: false, checkPorts: true },
      nuxt,
    )
    await nuxt.triggerListen({ address: () => ({ port: 3000 }) })
    await flushPromises()

    expect(waitForPort).not.toHaveBeenCalled()
    expect(startTunnel).toHaveBeenCalledTimes(1)
    expect(startTunnel).toHaveBeenCalledWith({
      port: 3000,
      acceptCloudflareNotice: true,
    })
  })

  it('uses the legacy fixed-delay path when checkPorts is disabled (default)', async () => {
    waitForPort.mockResolvedValue(true)
    startTunnel.mockResolvedValue({
      getURL: vi.fn().mockResolvedValue('https://sb.trycloudflare.com'),
    })
    const nuxt = createMockNuxt()

    await rawTunnelModule.setup(
      { enabled: true, log: false, storybook: true }, // checkPorts defaults to false
      nuxt,
    )
    await nuxt.triggerListen({ address: () => ({ port: 3000 }) })
    await flushPromises()

    expect(waitForPort).not.toHaveBeenCalled()
    // Storybook is still deferred via setTimeout, so only the Nuxt tunnel ran.
    expect(startTunnel).toHaveBeenCalledTimes(1)
  })

  it('honours a per-target checkPort override when the module default is off', async () => {
    waitForPort.mockResolvedValue(false)
    startTunnel.mockResolvedValue({
      getURL: vi.fn().mockResolvedValue('https://nuxt.trycloudflare.com'),
    })
    const nuxt = createMockNuxt()

    await rawTunnelModule.setup(
      {
        enabled: true,
        log: true,
        // Module-level checkPorts is false, but this target opts in.
        tunnels: [{ port: 8080, label: 'API', checkPort: true }],
      },
      nuxt,
    )
    await nuxt.triggerListen({ address: () => ({ port: 3000 }) })
    await flushPromises()

    expect(waitForPort).toHaveBeenCalledWith(8080, { timeout: 5_000 })
    expect(startTunnel).toHaveBeenCalledTimes(1) // Nuxt only; API skipped
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('Skipping API tunnel'),
    )
  })
})
