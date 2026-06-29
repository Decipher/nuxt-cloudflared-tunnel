# nuxt-cloudflared-tunnel

Nuxt module that opens a [Cloudflare Quick Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/) to the dev server on startup, via [`untun`](https://github.com/unjs/untun). Useful for sharing a running dev server (e.g. for testing on a phone, or with a webhook provider) without deploying.

It only runs in `nuxt dev`; it is a no-op in production builds.

## Why this exists

Nuxt has decent support for tunneling via `nuxi dev --tunnel` (also backed by Cloudflare Quick Tunnels), but using it as a one-off CLI flag has the same limitations as running `cloudflared` in a second terminal by hand:

- The tunnel isn't tied to the Nuxt config or committed to the repo, so every contributor has to know to pass the flag (or run `cloudflared` manually) themselves
- The URL isn't exposed anywhere the app can read it — building callback URLs (OAuth redirects, Stripe/GitHub webhooks) for dynamic Quick Tunnel URLs means manually copying the printed URL around
- There's no way to disable it per-environment (e.g. CI) via config, only by remembering to drop the flag

This module makes the tunnel a first-class part of the Nuxt config: `modules: ['nuxt-cloudflared-tunnel']`, committed once, and the URL is available at runtime via `useRuntimeConfig()` and `$tunnelUrl`/`$isTunnel` for exactly the callback-URL use case above.

### Current scope vs. where this could go

Today this module only wraps Cloudflare **Quick Tunnels** — ephemeral, free, no Cloudflare account config required, but the URL changes every time the dev server restarts. That's fine for ad-hoc sharing (phone testing, a one-off webhook test) but not for anything needing a stable URL across restarts (OAuth app settings, third-party webhook configs that don't support easy URL updates).

Possible future scope, not yet implemented:

- **Named Tunnel support** — a fixed hostname across restarts, via Cloudflare's authenticated tunnels (requires `cloudflared` login + tunnel/DNS setup the module would need to manage or document)
- **Custom hostname config** (`cloudflaredTunnel: { hostname: 'dev.example.com' }`) on top of named tunnel support
- DevTools panel integration, QR code output for mobile testing
- Tunnel health monitoring / automatic reconnection

None of this is built — the module is intentionally a small, focused wrapper around `untun`'s Quick Tunnel support today.

## Usage

```bash
pnpm add -D nuxt-cloudflared-tunnel
```

```ts
export default defineNuxtConfig({
  modules: ['nuxt-cloudflared-tunnel'],
})
```

Run `nuxt dev` and the tunnel starts automatically once the dev server is listening:

```
🚇 Starting Cloudflare tunnel...
🌐 Tunnel ready at: https://<random-words>.trycloudflare.com
🔓 Allowed tunnel host: <random-words>.trycloudflare.com
```

The tunnel URL is exposed to the app at runtime via `useRuntimeConfig().public.cloudflaredTunnelUrl`, and `$tunnelUrl` / `$isTunnel` from the runtime plugin ([`src/runtime/plugin.ts`](./src/runtime/plugin.ts)).

## Options

Configure via the `cloudflaredTunnel` key in `nuxt.config.ts`:

```ts
export default defineNuxtConfig({
  cloudflaredTunnel: {
    enabled: true, // set false to disable the tunnel entirely
    port: undefined, // override the port; defaults to the dev server's detected port (falls back to 3000)
    log: true, // set false to silence the module's console output
  },
})
```

| Option    | Type      | Default     | Description                                                            |
| --------- | --------- | ----------- | ------------------------------------------------------------------------ |
| `enabled` | `boolean` | `true`      | Disable to skip starting a tunnel (e.g. in CI or restricted networks). |
| `port`    | `number`  | `undefined` | Force a specific local port instead of auto-detecting the dev server's. |
| `log`     | `boolean` | `true`      | Log the tunnel URL and allowed host to the console.                    |
| `tunnels` | `TunnelTarget[]` | `[]` | Extra services to tunnel. Each `{ port, label, delay? }` opens a separate Quick Tunnel. |

### Storybook integration

```ts
export default defineNuxtConfig({
  cloudflaredTunnel: {
    storybook: {
      enabled: 'auto', // 'auto' (default) | true | false
      mode: 'auto',    // 'auto' (default) | 'dual-tunnel' | 'proxy'
      port: 6006,      // Storybook dev server port
      prefix: '/_storybook', // Proxy route prefix (proxy mode only)
    },
  },
})
```

| Option    | Type                  | Default       | Description                                                          |
| --------- | --------------------- | ------------- | -------------------------------------------------------------------- |
| `enabled` | `boolean \| 'auto'`  | `'auto'`      | `'auto'` probes `port` at startup. `true` forces on, `false` off.  |
| `mode`    | `'auto' \| 'dual-tunnel' \| 'proxy'` | `'auto'` | Tunnel strategy (see below).                                      |
| `port`    | `number`              | `6006`        | Storybook dev server port. Also reads `storybook.port` from Nuxt config. |
| `prefix`  | `string`              | `'/_storybook'` | Route prefix for proxy mode.                                      |

#### Tunnel modes

When Storybook is enabled, the module supports three strategies:

| Mode | Tunnel count | How it works |
| --- | --- | --- |
| `dual-tunnel` | 2 | Opens a separate Quick Tunnel for Storybook. Access Storybook at its own `*.trycloudflare.com` URL. |
| `proxy` | 1 | Nuxt reverse-proxies `/_storybook/` to the Storybook dev server through the single Nuxt tunnel. Access Storybook at `https://<nuxt-tunnel>.trycloudflare.com/_storybook/`. |
| `auto` | — | Uses `dual-tunnel` by default, or `proxy` if you set `mode: 'proxy'`. In `enabled: 'auto'` mode, skips entirely if Storybook isn't detected. |

The proxy mode injects a Vite plugin (`storybook-proxy`) that:

1. Intercepts requests under the configured prefix (default `/_storybook/`)
2. Forwards them to the Storybook dev server
3. Rewrites absolute paths in HTML/JS/CSS responses so Storybook assets resolve correctly under the sub-path
4. Proxies WebSocket connections for HMR

Dual-tunnel mode is simpler but requires two tunnels and gives you two URLs. Proxy mode gives a single URL but the proxy adds a thin rewriting layer.

#### Recommended workflow

```bash
# Terminal 1: Start Storybook
storybook dev -p 6006

# Terminal 2: Start Nuxt (auto-detects Storybook)
nuxt dev
```

With `enabled: 'auto'` (the default), the module probes port 6006 at startup. If Storybook is running, it opens a dual tunnel. If not, it logs a hint and skips Storybook tunneling.

## How it works

On the Nuxt `listen` hook (fired once the dev server is accepting connections), the module:

1. Resolves the port to tunnel — `options.port` if set, otherwise the dev server's listening port, falling back to `3000` if the address can't be read (e.g. a Unix socket).
2. Calls `startTunnel()` from `untun`, accepting Cloudflare's terms non-interactively.
3. Awaits `tunnel.getURL()` for the public `https://*.trycloudflare.com` URL.
4. Sets `vite.server.allowedHosts = true` so Vite's dev server accepts requests with the tunnel's `Host` header (Vite blocks unrecognized hosts by default).
5. Exposes the URL via `runtimeConfig.public.cloudflaredTunnelUrl`.

If `untun` fails to start a tunnel (no tunnel returned, or the call rejects — e.g. no network access to Cloudflare's edge), the error is logged with `console.error` and dev server startup continues unaffected.

### Storybook auto-detection

When `storybook.enabled` is `'auto'` (the default), the module probes the Storybook port at startup using a non-blocking TCP connection (`node:net.createConnection` with a 500ms timeout). This adds no startup latency in the common case (Storybook isn't running — connection refused is immediate). If the probe succeeds, the module configures tunnel targets accordingly.

## Testing

Unit tests live in [`test/module.test.ts`](./test/module.test.ts) and [`test/storybook-proxy.test.ts`](./test/storybook-proxy.test.ts), and run with `pnpm test`. `@nuxt/kit` and `untun` are mocked so the tests exercise the module's `setup()` logic directly — port resolution, the `listen` hook, runtime config/Vite mutation, Storybook auto-detection, proxy mode hook registration, and tunnel-start failure handling — without booting a real Nuxt instance or network tunnel.

The proxy tests spin up a real `node:http` server as a mock Storybook backend and verify request forwarding, prefix stripping, HTML/JS/CSS path rewriting, binary passthrough, and 502 error handling.

## Development

```bash
pnpm install
pnpm dev        # playground dev server with the module loaded
pnpm test
pnpm lint
```
