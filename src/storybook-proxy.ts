import type { Plugin } from 'vite'
import { connect as netConnect } from 'node:net'

export interface StorybookProxyOptions {
  /** Storybook dev server port. */
  port: number
  /** URL prefix under which Storybook is exposed. */
  prefix: string
  /** Whether to log proxy activity. */
  log?: boolean
}

/**
 * Vite plugin that proxies requests under `prefix` to a Storybook dev server.
 *
 * The proxy rewrites HTML responses so that absolute paths (`/iframe.html`,
 * `/sb-addons/...`, etc.) are prefixed with the configured prefix. This lets
 * Storybook be served from a sub-path behind a single Cloudflare tunnel.
 *
 * WebSocket connections for HMR are also proxied.
 *
 * @param options - Proxy configuration.
 * @returns Vite plugin instance.
 */
export function storybookProxyPlugin(options: StorybookProxyOptions): Plugin {
  const { port, prefix, log = false } = options
  const target = `http://localhost:${port}`
  const prefixRegex = new RegExp(`^${prefix}`)

  return {
    name: 'storybook-proxy',
    configureServer(server) {
      // Intercept requests under the prefix
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? ''

        if (!url.startsWith(prefix)) {
          return next()
        }

        // Strip the prefix for upstream
        const upstreamUrl = url.replace(prefixRegex, '') || '/'

        if (log) {
          console.log(`[storybook-proxy] ${url} -> ${target}${upstreamUrl}`)
        }

        try {
          // Fetch from Storybook
          const response = await fetch(`${target}${upstreamUrl}`, {
            method: req.method,
            headers: req.headers as Record<string, string>,
          })

          const contentType = response.headers.get('content-type') ?? ''

          // Copy safe headers
          const passThrough = [
            'content-type',
            'cache-control',
            'etag',
            'last-modified',
          ]

          for (const header of passThrough) {
            const value = response.headers.get(header)
            if (value) {
              res.setHeader(header, value)
            }
          }

          res.statusCode = response.status

          if (contentType.includes('text/html')) {
            // Rewrite absolute paths in HTML
            let body = await response.text()
            body = rewriteHtmlPaths(body, prefix)
            res.setHeader('content-length', Buffer.byteLength(body))
            res.end(body)
          } else if (
            contentType.includes('javascript')
            || contentType.includes('text/css')
          ) {
            // Rewrite paths in JS/CSS
            let body = await response.text()
            body = rewriteAssetPaths(body, prefix)
            res.setHeader('content-length', Buffer.byteLength(body))
            res.end(body)
          } else {
            // Pass through binary/other content
            const buffer = Buffer.from(await response.arrayBuffer())
            res.setHeader('content-length', buffer.length)
            res.end(buffer)
          }
        } catch (error) {
          console.error('[storybook-proxy] Error:', error)
          res.statusCode = 502
          res.setHeader('content-type', 'text/plain')
          res.end(
            `Storybook proxy error: ${error instanceof Error ? error.message : 'unknown'}`,
          )
        }
      })

      // WebSocket proxy for HMR
      server.httpServer?.on('upgrade', (req, socket, head) => {
        const url = req.url ?? ''

        if (!url.startsWith(prefix)) {
          return
        }

        const upstreamUrl = url.replace(prefixRegex, '') || '/'
        const targetUrl = new URL(target)

        if (log) {
          console.log(`[storybook-proxy WS] ${url} -> ${target}${upstreamUrl}`)
        }

        const proxySocket = netConnect(
          {
            port: Number(targetUrl.port),
            host: targetUrl.hostname,
          },
          () => {
            const rawHeaders
              = `${req.method} ${upstreamUrl} HTTP/${req.httpVersion}\r\n`
              + Object.entries(req.headers)
                .filter(([k]) => k !== 'host')
                .map(([k, v]) => `${k}: ${v}`)
                .join('\r\n')
              + `\r\nhost: ${targetUrl.host}\r\n\r\n`

            proxySocket.write(rawHeaders)
            proxySocket.write(head)
            socket.write('HTTP/1.1 101 Switching Protocols\r\n\r\n')
            proxySocket.pipe(socket)
            socket.pipe(proxySocket)
          },
        )

        proxySocket.on('error', (err: Error) => {
          if (log) {
            console.error('[storybook-proxy WS] Error:', err)
          }
          socket.destroy()
        })

        socket.on('error', () => {
          proxySocket.destroy()
        })
      })
    },
  }
}

/**
 * Rewrite absolute path references in HTML to include the prefix.
 *
 * @param html - The HTML response body.
 * @param prefix - The proxy prefix to add.
 * @returns Rewritten HTML.
 */
function rewriteHtmlPaths(html: string, prefix: string): string {
  return html
    // href="/..." and src="/..."
    .replace(/((?:href|src)\s*=\s*["'])\//g, `$1${prefix}/`)
    // window.location based redirects
    .replace(/(["'])\/iframe\.html/g, `$1${prefix}/iframe.html`)
    // SB manager config paths
    .replace(/(["'])\/sb-/, `$1${prefix}/sb-`)
    // manifest.json, favicon, etc.
    .replace(/(["'])\/manifest/, `$1${prefix}/manifest`)
    // Asset imports in inline scripts
    .replace(/(["'])\/@vite\//g, `$1${prefix}/@vite/`)
    .replace(/(["'])\/node_modules\//g, `$1${prefix}/node_modules/`)
}

/**
 * Rewrite absolute path references in JS/CSS to include the prefix.
 *
 * @param body - The JS or CSS response body.
 * @param prefix - The proxy prefix to add.
 * @returns Rewritten body.
 */
function rewriteAssetPaths(body: string, prefix: string): string {
  return body
    .replace(/(["'])\/@vite\//g, `$1${prefix}/@vite/`)
    .replace(/(["'])\/sb-/g, `$1${prefix}/sb-`)
    .replace(/url\((["']?)\//g, `url($1${prefix}/`)
}
