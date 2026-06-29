# nuxt-cloudflared-tunnel

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![License][license-src]][license-href]
[![Nuxt][nuxt-src]][nuxt-href]
[![codecov][codecov-src]][codecov-href]

Nuxt module that opens a [Cloudflare Quick Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/) to the dev server on startup, via [`untun`](https://github.com/unjs/untun). Useful for sharing a running dev server (e.g. for testing on a phone, or with a webhook provider) without deploying. It only runs in `nuxt dev`, it is a no-op in production builds.

Submit bug reports and feature suggestions, or track changes, in the [issue queue](https://github.com/Decipher/nuxt-cloudflared-tunnel/issues).

- [Release notes](/CHANGELOG.md)

## Table of contents

- [Introduction](#introduction)
- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Configuration](#configuration)
- [How it works](#how-it-works)
- [FAQ](#faq)
- [Roadmap](#roadmap)
- [Testing](#testing)
- [Contributing](#contributing)
- [Maintainers](#maintainers)

## Introduction

Nuxt has decent support for tunneling via `nuxi dev --tunnel` (also backed by Cloudflare Quick Tunnels), but using it as a one-off CLI flag has the same limitations as running `cloudflared` in a second terminal by hand:

- The tunnel isn't tied to the Nuxt config or committed to the repo, so every contributor has to know to pass the flag (or run `cloudflared` manually) themselves.
- The URL isn't exposed anywhere the app can read it. Building callback URLs (OAuth redirects, Stripe/GitHub webhooks) for dynamic Quick Tunnel URLs means manually copying the printed URL around.
- There's no way to disable it per-environment (e.g. CI) via config, only by remembering to drop the flag.

This module makes the tunnel a first-class part of the Nuxt config: `modules: ['nuxt-cloudflared-tunnel']`, committed once, and the URL is available at runtime via `useRuntimeConfig()` and `$tunnelUrl`/`$isTunnel`, for exactly the callback-URL use case above.

## Features

- Starts a Cloudflare Quick Tunnel automatically on `nuxt dev`, no Cloudflare account or `cloudflared` login required.
- Tunnel URL exposed at runtime via `useRuntimeConfig()` and a `$tunnelUrl` / `$isTunnel` plugin.
- Automatically allows the tunnel host through Vite's dev server host check.
- Tunnel additional local services (e.g. Storybook, an API) over their own Quick Tunnels via the `storybook` shorthand or a generic `tunnels` array.
- No-op outside `nuxt dev`. Nothing added to production builds.
- Configurable port, and can be disabled entirely (e.g. in CI).

## Requirements

This module requires:

- Nuxt `^4.0.0`
- A network path to Cloudflare's edge (Quick Tunnels are created over the open internet, so they won't work fully offline or behind an egress-restricted proxy)

## Installation

1. Add `nuxt-cloudflared-tunnel` as a dev dependency:

   ```bash
   # pnpm
   pnpm add -D nuxt-cloudflared-tunnel

   # yarn
   yarn add -D nuxt-cloudflared-tunnel

   # npm
   npm install -D nuxt-cloudflared-tunnel
   ```

1. Add it to the `modules` section of `nuxt.config.ts`:

   ```ts
   export default defineNuxtConfig({
     modules: ['nuxt-cloudflared-tunnel'],
   })
   ```

That's it. Run `nuxt dev` and the tunnel starts automatically once the dev server is listening:

```text
🚇 Starting Cloudflare tunnel for Nuxt (:3000)...
🌐 Nuxt tunnel ready at: https://<random-words>.trycloudflare.com
🔓 Allowed tunnel host: <random-words>.trycloudflare.com
```

The tunnel URL is exposed to the app at runtime via `useRuntimeConfig().public.cloudflaredTunnelUrl`, and `$tunnelUrl` / `$isTunnel` from the runtime plugin ([`src/runtime/plugin.ts`](./src/runtime/plugin.ts)).

## Configuration

Configure the module at the `cloudflaredTunnel` key in `nuxt.config.ts`:

```ts
export default defineNuxtConfig({
  cloudflaredTunnel: {
    enabled: true, // set false to disable the tunnel entirely
    port: undefined, // override the port; defaults to the dev server's detected port (falls back to 3000)
    log: true, // set false to silence the module's console output
    storybook: false, // set true to also tunnel a Storybook dev server on :6006
    tunnels: [], // arbitrary extra tunnel targets
  },
})
```

| Option      | Type              | Default     | Description                                                                                       |
| ----------- | ----------------- | ----------- | ------------------------------------------------------------------------------------------------- |
| `enabled`   | `boolean`         | `true`      | Disable to skip starting a tunnel (e.g. in CI or restricted networks).                            |
| `port`      | `number`          | `undefined` | Force a specific local port instead of auto-detecting the dev server's.                           |
| `log`       | `boolean`         | `true`      | Log the tunnel URL and allowed host to the console.                                               |
| `storybook` | `boolean`         | `false`     | Shorthand to tunnel a Storybook dev server on port 6006 (5s startup delay).                       |
| `tunnels`   | `TunnelTarget[]`  | `[]`        | Extra services to tunnel. Each `{ port, label, delay? }` opens a separate Quick Tunnel.           |

### Tunneling extra services

The `storybook` option is a convenience shorthand for the most common case. For anything else (API servers, Storybook on a non-default port, etc.), use the generic `tunnels` array:

```ts
export default defineNuxtConfig({
  cloudflaredTunnel: {
    tunnels: [
      { port: 6006, label: 'Storybook', delay: 5_000 },
      { port: 8080, label: 'API' },
    ],
  },
})
```

Each target opens a separate Quick Tunnel with its own `*.trycloudflare.com` URL. The `delay` field (in ms) defers the tunnel start - useful for secondary services that take longer to boot.

#### Note on tunneling Storybook

In Nuxt 3/4, Storybook runs as a completely separate process (via `@storybook-vue/nuxt`), not inside Nuxt. The module simply opens a tunnel to whatever is listening on the configured port - it doesn't manage Storybook's lifecycle.

Cloudflare Quick Tunnels use random `*.trycloudflare.com` hostnames. Vite (which powers Storybook's dev server) blocks requests from unrecognized hosts by default, so you must configure Storybook's Vite to allow all hosts:

```ts
// .storybook/main.ts
viteFinal: (config) => {
  config.server ??= {}
  config.server.allowedHosts = true
  return config
},
```

The module handles the Nuxt side automatically (`vite.server.allowedHosts = true`), but Storybook's Vite config is separate.

The [`playground`](./playground) ships a working Storybook setup (config under `.storybook/`, sample components and stories in `playground/components/`) wired up with `cloudflaredTunnel: { storybook: true }` - run `pnpm storybook` alongside `pnpm dev` to see both services tunneled.

## How it works

On the Nuxt `listen` hook (fired once the dev server is accepting connections), the module:

1. Resolves the port to tunnel: `options.port` if set, otherwise the dev server's listening port, falling back to `3000` if the address can't be read (e.g. a Unix socket).
2. Calls `startTunnel()` from `untun`, accepting Cloudflare's terms non-interactively.
3. Awaits `tunnel.getURL()` for the public `https://*.trycloudflare.com` URL.
4. Sets `vite.server.allowedHosts = true` so Vite's dev server accepts requests with the tunnel's `Host` header (Vite blocks unrecognized hosts by default).
5. Exposes the URL via `runtimeConfig.public.cloudflaredTunnelUrl`.

For each extra tunnel target (including `storybook: true`), steps 2-3 repeat with the target's port. Targets with a `delay` are started via `setTimeout` so the primary tunnel isn't blocked.

If `untun` fails to start a tunnel (no tunnel returned, or the call rejects, e.g. no network access to Cloudflare's edge), the error is logged with `console.error` and dev server startup continues unaffected.

## FAQ

**Q: Does this work in production?**

**A:** No, by design. The module only hooks the `listen` event, which only fires in `nuxt dev`. There is no code path that starts a tunnel in a built/production app.

**Q: Why does the tunnel URL change every time I restart the dev server?**

**A:** It's a Cloudflare Quick Tunnel, which is ephemeral by design: free, anonymous, and reassigned on every connection. See [Roadmap](#roadmap) for plans around stable, named tunnels.

**Q: Can I use this with `nuxi dev --tunnel` at the same time?**

**A:** No, both would try to tunnel the same port. Use one or the other; this module exists so the tunnel doesn't depend on remembering a CLI flag.

## Roadmap

Today this module only wraps Cloudflare **Quick Tunnels**: ephemeral, free, no Cloudflare account config required, but the URL changes every time the dev server restarts. That's fine for ad-hoc sharing (phone testing, a one-off webhook test) but not for anything needing a stable URL across restarts (OAuth app settings, third-party webhook configs that don't support easy URL updates).

Possible future scope, not yet implemented:

- **Named Tunnel support**: a fixed hostname across restarts, via Cloudflare's authenticated tunnels (requires `cloudflared` login plus tunnel/DNS setup the module would need to manage or document).
- **Custom hostname config** (`cloudflaredTunnel: { hostname: 'dev.example.com' }`) on top of named tunnel support.
- DevTools panel integration, QR code output for mobile testing.
- Tunnel health monitoring / automatic reconnection.

None of this is built. The module is intentionally a small, focused wrapper around `untun`'s Quick Tunnel support today.

## Testing

Unit tests live in [`test/module.test.ts`](./test/module.test.ts) and run with `pnpm test`. `@nuxt/kit` and `untun` are mocked so the tests exercise the module's `setup()` logic directly: port resolution, the `listen` hook, runtime config/Vite mutation, `storybook` shorthand, `tunnels` array handling, and tunnel-start failure handling, without booting a real Nuxt instance or network tunnel.

## Contributing

<details>
  <summary>Local development</summary>

```bash
# Install dependencies
pnpm install

# Generate type stubs
pnpm dev:prepare

# Develop with the playground
pnpm dev

# Build the playground
pnpm dev:build

# Run Storybook (on :6006) - tunneled via the module's `storybook` option
pnpm storybook

# Build Storybook as a static site
pnpm build-storybook

# Run ESLint
pnpm lint

# Run Vitest
pnpm test
pnpm test:watch
```

</details>

Bug reports and feature requests are welcome via [GitHub Issues](https://github.com/Decipher/nuxt-cloudflared-tunnel/issues).

## Maintainers

<a href="https://github.com/Decipher"><img src="https://github.com/Decipher.png" width="48" alt="Decipher" /></a>

[Stuart Clark](https://github.com/Decipher) ([@Decipher](https://github.com/Decipher))

<!-- Badges -->
[npm-version-src]: https://img.shields.io/npm/v/nuxt-cloudflared-tunnel/latest.svg?style=flat&colorA=020420&colorB=00DC82
[npm-version-href]: https://npmjs.com/package/nuxt-cloudflared-tunnel

[npm-downloads-src]: https://img.shields.io/npm/dm/nuxt-cloudflared-tunnel.svg?style=flat&colorA=020420&colorB=00DC82
[npm-downloads-href]: https://npmjs.com/package/nuxt-cloudflared-tunnel

[license-src]: https://img.shields.io/npm/l/nuxt-cloudflared-tunnel.svg?style=flat&colorA=020420&colorB=00DC82
[license-href]: https://npmjs.com/package/nuxt-cloudflared-tunnel

[nuxt-src]: https://img.shields.io/badge/Nuxt-020420?logo=nuxt.js
[nuxt-href]: https://nuxt.com

[codecov-src]: https://codecov.io/gh/Decipher/nuxt-cloudflared-tunnel/graph/badge.svg
[codecov-href]: https://codecov.io/gh/Decipher/nuxt-cloudflared-tunnel
