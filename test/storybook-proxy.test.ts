import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { storybookProxyPlugin } from '../src/storybook-proxy'

/**
 * Helper: create a minimal HTTP server that records requests and responds
 * with configurable content.
 */
function createMockStorybookServer(responses: {
  body: string
  contentType?: string
  status?: number
}): { server: Server, port: number, requests: Array<{ url: string, method: string }> } {
  const requests: Array<{ url: string, method: string }> = []
  const server = createServer((req, res) => {
    requests.push({ url: req.url ?? '/', method: req.method ?? 'GET' })
    res.writeHead(responses.status ?? 200, {
      'content-type': responses.contentType ?? 'text/html',
    })
    res.end(responses.body)
  })

  server.listen(0)
  const port = (server.address() as AddressInfo).port

  return { server, port, requests }
}

describe('storybookProxyPlugin', () => {
  describe('plugin metadata', () => {
    it('returns a Vite plugin with the correct name', () => {
      const plugin = storybookProxyPlugin({ port: 6006, prefix: '/_storybook' })
      expect(plugin.name).toBe('storybook-proxy')
    })

    it('exposes configureServer hook', () => {
      const plugin = storybookProxyPlugin({ port: 6006, prefix: '/_storybook' })
      expect(typeof plugin.configureServer).toBe('function')
    })
  })

  describe('request proxying', () => {
    let sbServer: { server: Server, port: number, requests: Array<{ url: string, method: string }> }
    let plugin: ReturnType<typeof storybookProxyPlugin>

    beforeEach(() => {
      sbServer = createMockStorybookServer({
        body: '<html><head></head><body>Storybook</body></html>',
        contentType: 'text/html',
      })

      plugin = storybookProxyPlugin({
        port: sbServer.port,
        prefix: '/_storybook',
        log: false,
      })
    })

    afterEach(() => {
      sbServer.server.close()
    })

    it('passes through requests outside the prefix', async () => {
      const mockServer = {
        middlewares: { use: vi.fn() },
        httpServer: null,
      }

      plugin.configureServer?.(mockServer as never)

      const handler = mockServer.middlewares.use.mock.calls[0][0]
      const req = { url: '/some-other-path', method: 'GET', headers: {} }
      const res = { setHeader: vi.fn(), end: vi.fn(), statusCode: 0 }
      const next = vi.fn()

      await handler(req, res, next)

      expect(next).toHaveBeenCalled()
    })

    it('proxies requests under the prefix to the Storybook server', async () => {
      const mockServer = {
        middlewares: { use: vi.fn() },
        httpServer: null,
      }

      plugin.configureServer?.(mockServer as never)

      const handler = mockServer.middlewares.use.mock.calls[0][0]
      const req = { url: '/_storybook/', method: 'GET', headers: {} }
      const res = {
        setHeader: vi.fn(),
        end: vi.fn(),
        statusCode: 0,
      }
      const next = vi.fn()

      await handler(req, res, next)

      expect(next).not.toHaveBeenCalled()
      expect(sbServer.requests).toHaveLength(1)
      expect(sbServer.requests[0].url).toBe('/')
      expect(res.statusCode).toBe(200)
    })

    it('strips the prefix when forwarding upstream', async () => {
      const mockServer = {
        middlewares: { use: vi.fn() },
        httpServer: null,
      }

      plugin.configureServer?.(mockServer as never)

      const handler = mockServer.middlewares.use.mock.calls[0][0]
      const req = { url: '/_storybook/iframe.html', method: 'GET', headers: {} }
      const res = { setHeader: vi.fn(), end: vi.fn(), statusCode: 0 }
      const next = vi.fn()

      await handler(req, res, next)

      expect(sbServer.requests[0].url).toBe('/iframe.html')
    })

    it('handles empty path after prefix as root', async () => {
      const mockServer = {
        middlewares: { use: vi.fn() },
        httpServer: null,
      }

      plugin.configureServer?.(mockServer as never)

      const handler = mockServer.middlewares.use.mock.calls[0][0]
      const req = { url: '/_storybook', method: 'GET', headers: {} }
      const res = { setHeader: vi.fn(), end: vi.fn(), statusCode: 0 }
      const next = vi.fn()

      await handler(req, res, next)

      expect(sbServer.requests[0].url).toBe('/')
    })
  })

  describe('HTML path rewriting', () => {
    let sbServer: { server: Server, port: number, requests: Array<{ url: string, method: string }> }
    let plugin: ReturnType<typeof storybookProxyPlugin>

    beforeEach(() => {
      sbServer = createMockStorybookServer({
        body: `<html>
          <head>
            <link rel="icon" href="/favicon.ico" />
            <script src="/sb-manager.js"></script>
            <script src="/@vite/client"></script>
          </head>
          <body>
            <iframe src="/iframe.html"></iframe>
          </body>
        </html>`,
        contentType: 'text/html',
      })

      plugin = storybookProxyPlugin({
        port: sbServer.port,
        prefix: '/_storybook',
        log: false,
      })
    })

    afterEach(() => {
      sbServer.server.close()
    })

    it('rewrites href and src attributes in HTML responses', async () => {
      const mockServer = {
        middlewares: { use: vi.fn() },
        httpServer: null,
      }

      plugin.configureServer?.(mockServer as never)

      const handler = mockServer.middlewares.use.mock.calls[0][0]
      const req = { url: '/_storybook/', method: 'GET', headers: {} }
      const res = { setHeader: vi.fn(), end: vi.fn(), statusCode: 0 }
      const next = vi.fn()

      await handler(req, res, next)

      const responseBody = res.end.mock.calls[0][0] as string
      expect(responseBody).toContain('href="/_storybook/favicon.ico"')
      expect(responseBody).toContain('src="/_storybook/sb-manager.js"')
      expect(responseBody).toContain('src="/_storybook/@vite/client"')
      expect(responseBody).toContain('src="/_storybook/iframe.html"')
    })
  })

  describe('JS/CSS asset rewriting', () => {
    let sbServer: { server: Server, port: number, requests: Array<{ url: string, method: string }> }
    let plugin: ReturnType<typeof storybookProxyPlugin>

    beforeEach(() => {
      sbServer = createMockStorybookServer({
        body: `import("/@vite/foo");var x="/sb-addons/bar";.bg{background:url(/img.png)}`,
        contentType: 'application/javascript',
      })

      plugin = storybookProxyPlugin({
        port: sbServer.port,
        prefix: '/_sb',
        log: false,
      })
    })

    afterEach(() => {
      sbServer.server.close()
    })

    it('rewrites asset paths in JS responses', async () => {
      const mockServer = {
        middlewares: { use: vi.fn() },
        httpServer: null,
      }

      plugin.configureServer?.(mockServer as never)

      const handler = mockServer.middlewares.use.mock.calls[0][0]
      const req = { url: '/_sb/main.js', method: 'GET', headers: {} }
      const res = { setHeader: vi.fn(), end: vi.fn(), statusCode: 0 }
      const next = vi.fn()

      await handler(req, res, next)

      const responseBody = res.end.mock.calls[0][0] as string
      expect(responseBody).toContain('"/_sb/@vite/foo"')
      expect(responseBody).toContain('"/_sb/sb-addons/bar"')
      expect(responseBody).toContain('url(/_sb/img.png)')
    })
  })

  describe('binary passthrough', () => {
    let sbServer: { server: Server, port: number, requests: Array<{ url: string, method: string }> }
    let plugin: ReturnType<typeof storybookProxyPlugin>

    beforeEach(() => {
      sbServer = createMockStorybookServer({
        body: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d]).toString('binary'),
        contentType: 'image/png',
      })

      plugin = storybookProxyPlugin({
        port: sbServer.port,
        prefix: '/_storybook',
        log: false,
      })
    })

    afterEach(() => {
      sbServer.server.close()
    })

    it('passes through binary content without rewriting', async () => {
      const mockServer = {
        middlewares: { use: vi.fn() },
        httpServer: null,
      }

      plugin.configureServer?.(mockServer as never)

      const handler = mockServer.middlewares.use.mock.calls[0][0]
      const req = { url: '/_storybook/logo.png', method: 'GET', headers: {} }
      const res = { setHeader: vi.fn(), end: vi.fn(), statusCode: 0 }
      const next = vi.fn()

      await handler(req, res, next)

      expect(res.setHeader).toHaveBeenCalledWith('content-type', 'image/png')
      expect(res.end).toHaveBeenCalledTimes(1)
    })
  })

  describe('error handling', () => {
    it('returns 502 when Storybook server is unreachable', async () => {
      const plugin = storybookProxyPlugin({
        port: 1,
        prefix: '/_storybook',
        log: false,
      })

      const mockServer = {
        middlewares: { use: vi.fn() },
        httpServer: null,
      }

      plugin.configureServer?.(mockServer as never)

      const handler = mockServer.middlewares.use.mock.calls[0][0]
      const req = { url: '/_storybook/', method: 'GET', headers: {} }
      const res = { setHeader: vi.fn(), end: vi.fn(), statusCode: 0 }
      const next = vi.fn()

      await handler(req, res, next)

      expect(res.statusCode).toBe(502)
      expect(next).not.toHaveBeenCalled()
    })
  })

  describe('custom prefix', () => {
    it('works with a non-default prefix', () => {
      const plugin = storybookProxyPlugin({ port: 6006, prefix: '/sb' })
      expect(plugin.name).toBe('storybook-proxy')
    })
  })
})
