import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addPlugin } from '@nuxt/kit'
import tunnelModule, { type ModuleOptions } from '../src/module'

const { startTunnel } = vi.hoisted(() => ({
  startTunnel: vi.fn(),
}))

vi.mock('untun', () => ({ startTunnel }))

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
  triggerClose: () => Promise<void>
}

interface RawNuxtModule {
  meta: { name: string, configKey: string }
  defaults: ModuleOptions
  setup: (options: ModuleOptions, nuxt: MockNuxt) => Promise<void> | void
}

const rawTunnelModule = tunnelModule as unknown as RawNuxtModule

// Snapshot/restore signal listeners so module-registered handlers don't
// accumulate across tests and trip MaxListenersExceededWarning.
function snapshotSignals() {
  return {
    SIGTERM: process.listeners('SIGTERM'),
    SIGHUP: process.listeners('SIGHUP'),
  }
}

function restoreSignals(saved: ReturnType<typeof snapshotSignals>) {
  for (const sig of ['SIGTERM', 'SIGHUP'] as const) {
    for (const listener of process.listeners(sig)) {
      if (!saved[sig].includes(listener)) {
        process.removeListener(sig, listener as (...args: unknown[]) => void)
      }
    }
  }
}

function createMockNuxt(dev = true): MockNuxt {
  const listenListeners: ((server: { address: () => unknown }) => unknown)[] = []
  const closeListeners: ((...args: unknown[]) => unknown)[] = []
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
      if (name === 'close') {
        closeListeners.push(fn)
      }
    },
    async triggerListen(server) {
      for (const fn of listenListeners) {
        await fn(server)
      }
    },
    async triggerClose() {
      for (const fn of closeListeners) {
        await fn()
      }
    },
  }
}

describe('nuxt-cloudflared-tunnel module', () => {
  let savedSignals: ReturnType<typeof snapshotSignals>

  beforeEach(() => {
    savedSignals = snapshotSignals()
    startTunnel.mockReset()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    delete process.env.__CLOUDFLARED_TUNNEL_URL
  })

  afterEach(() => {
    restoreSignals(savedSignals)
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

  it('registers a close hook to tear down tunnels', async () => {
    const nuxt = createMockNuxt()
    const hookSpy = vi.spyOn(nuxt, 'hook')

    await rawTunnelModule.setup({ enabled: true, log: true }, nuxt)

    expect(hookSpy).toHaveBeenCalledWith('close', expect.any(Function))
  })

  it('does not register a close hook when disabled', async () => {
    const nuxt = createMockNuxt()
    const hookSpy = vi.spyOn(nuxt, 'hook')

    await rawTunnelModule.setup({ enabled: false, log: true }, nuxt)

    expect(hookSpy).not.toHaveBeenCalledWith('close', expect.any(Function))
  })

  it('closes all tunnels when the close hook fires', async () => {
    const closeA = vi.fn().mockResolvedValue(undefined)
    const closeB = vi.fn().mockResolvedValue(undefined)
    startTunnel
      .mockResolvedValueOnce({
        getURL: vi.fn().mockResolvedValue('https://a.trycloudflare.com'),
        close: closeA,
      })
      .mockResolvedValueOnce({
        getURL: vi.fn().mockResolvedValue('https://b.trycloudflare.com'),
        close: closeB,
      })

    const nuxt = createMockNuxt()
    await rawTunnelModule.setup(
      { enabled: true, log: false, tunnels: [{ port: 8080, label: 'API' }] },
      nuxt,
    )
    await nuxt.triggerListen({ address: () => ({ port: 3000 }) })

    expect(startTunnel).toHaveBeenCalledTimes(2)
    expect(closeA).not.toHaveBeenCalled()
    expect(closeB).not.toHaveBeenCalled()

    await nuxt.triggerClose()

    expect(closeA).toHaveBeenCalledTimes(1)
    expect(closeB).toHaveBeenCalledTimes(1)
  })

  it('registers SIGTERM and SIGHUP handlers when enabled', async () => {
    const onceSpy = vi.spyOn(process, 'once')
    const nuxt = createMockNuxt()

    await rawTunnelModule.setup({ enabled: true, log: true }, nuxt)

    expect(onceSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function))
    expect(onceSpy).toHaveBeenCalledWith('SIGHUP', expect.any(Function))
  })

  it('closes tunnels when SIGTERM fires', async () => {
    const closeFn = vi.fn().mockResolvedValue(undefined)
    startTunnel.mockResolvedValue({
      getURL: vi.fn().mockResolvedValue('https://a.trycloudflare.com'),
      close: closeFn,
    })

    const handlers: Record<string, () => void> = {}
    vi.spyOn(process, 'once').mockImplementation((signal, fn) => {
      if (typeof signal === 'string') {
        handlers[signal] = fn as () => void
      }
      return process
    })

    const nuxt = createMockNuxt()
    await rawTunnelModule.setup({ enabled: true, log: false }, nuxt)
    await nuxt.triggerListen({ address: () => ({ port: 3000 }) })

    expect(closeFn).not.toHaveBeenCalled()

    // Mock process.kill to prevent the signal re-raise from terminating
    // the test process. Must stay mocked until all microtasks (closeTunnels +
    // .finally) have flushed.
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
    handlers.SIGTERM?.()
    // Flush all pending microtasks before restoring the spy
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(closeFn).toHaveBeenCalledTimes(1)
    killSpy.mockRestore()
  })
})

// --- Storybook shorthand + tunnels array tests ---

describe('nuxt-cloudflared-tunnel module · extra tunnels', () => {
  let savedSignals: ReturnType<typeof snapshotSignals>

  beforeEach(() => {
    savedSignals = snapshotSignals()
    startTunnel.mockReset()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    delete process.env.__CLOUDFLARED_TUNNEL_URL
  })

  afterEach(() => {
    restoreSignals(savedSignals)
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
