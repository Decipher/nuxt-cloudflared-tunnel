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
    storybook?: { port?: number }
  }
  hook: (name: string, fn: (...args: unknown[]) => unknown) => void
  triggerListen: (server: { address: () => unknown }) => Promise<void>
  registeredHooks: string[]
}

interface RawNuxtModule {
  meta: { name: string, configKey: string }
  defaults: ModuleOptions
  setup: (options: ModuleOptions, nuxt: MockNuxt) => Promise<void> | void
}

const rawTunnelModule = tunnelModule as unknown as RawNuxtModule

function createMockNuxt(dev = true, overrides?: Partial<MockNuxt['options']>): MockNuxt {
  const listenListeners: ((server: { address: () => unknown }) => unknown)[] = []
  const viteConfigListeners: ((config: unknown) => unknown)[] = []
  const registeredHooks: string[] = []
  return {
    options: {
      dev,
      vite: { server: {} },
      runtimeConfig: { public: {} },
      ...overrides,
    },
    hook(name, fn) {
      registeredHooks.push(name)
      if (name === 'listen') {
        listenListeners.push(fn as (server: { address: () => unknown }) => unknown)
      }
      if (name === 'vite:extendConfig') {
        viteConfigListeners.push(fn as (config: unknown) => unknown)
      }
    },
    async triggerListen(server) {
      for (const fn of listenListeners) {
        await fn(server)
      }
    },
    registeredHooks,
  }
}

describe('nuxt-cloudflared-tunnel module', () => {
  beforeEach(() => {
    startTunnel.mockReset()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
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

// --- Storybook integration tests ---

describe('nuxt-cloudflared-tunnel module · Storybook', () => {
  beforeEach(() => {
    startTunnel.mockReset()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('defaults storybook to auto-detection', () => {
    expect(rawTunnelModule.defaults).toMatchObject({
      storybook: { enabled: 'auto', mode: 'auto' },
    })
  })

  it('registers only listen hook in auto mode (no Storybook running)', async () => {
    const nuxt = createMockNuxt()

    await rawTunnelModule.setup(
      { enabled: true, log: false, storybook: { enabled: 'auto' } },
      nuxt,
    )

    expect(nuxt.registeredHooks).toContain('listen')
    expect(nuxt.registeredHooks).not.toContain('vite:extendConfig')
  })

  it('registers vite:extendConfig hook in explicit proxy mode', async () => {
    const nuxt = createMockNuxt()

    await rawTunnelModule.setup(
      { enabled: true, log: false, storybook: { enabled: true, mode: 'proxy' } },
      nuxt,
    )

    expect(nuxt.registeredHooks).toContain('vite:extendConfig')
  })

  it('does not register vite:extendConfig in explicit dual-tunnel mode', async () => {
    const nuxt = createMockNuxt()

    await rawTunnelModule.setup(
      { enabled: true, log: false, storybook: { enabled: true, mode: 'dual-tunnel' } },
      nuxt,
    )

    expect(nuxt.registeredHooks).not.toContain('vite:extendConfig')
  })

  it('skips Storybook entirely when explicitly disabled', async () => {
    const nuxt = createMockNuxt()

    await rawTunnelModule.setup(
      { enabled: true, log: false, storybook: { enabled: false } },
      nuxt,
    )

    expect(nuxt.registeredHooks).toContain('listen')
    expect(nuxt.registeredHooks).not.toContain('vite:extendConfig')
  })

  it('reads port from nuxt.options.storybook.port', async () => {
    const nuxt = createMockNuxt(true, { storybook: { port: 7007 } })

    await rawTunnelModule.setup(
      { enabled: true, log: false, storybook: { enabled: true, mode: 'proxy' } },
      nuxt,
    )

    // vite:extendConfig hook should be registered
    expect(nuxt.registeredHooks).toContain('vite:extendConfig')
  })
})
