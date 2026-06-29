# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-06-29

### Added

- Nuxt module that starts a Cloudflare Quick Tunnel automatically on `nuxt dev`, powered by [`untun`](https://github.com/unjs/untun). No Cloudflare account or `cloudflared` login required.
- Tunnel URL exposed to the app at runtime through `useRuntimeConfig()` and a `$tunnelUrl` / `$isTunnel` plugin, for building callback URLs (OAuth redirects, Stripe/GitHub webhooks, etc.).
- Vite's `allowedHosts` configured automatically so the dev server accepts requests over the tunnel's `*.trycloudflare.com` host.
- Module options: `enabled` (disable per-environment, e.g. CI or restricted networks), `port` (override the dev server's detected port), and `log` (silence console output).
- Generic `tunnels` array (`{ port, label, delay? }`) to open additional Quick Tunnels for other local services alongside the Nuxt app.
- `storybook` shorthand option to tunnel a Storybook dev server on port 6006 alongside the Nuxt app, started after a short delay so secondary services have time to boot.
- Graceful failure: if a tunnel can't start (no tunnel returned, or no network path to Cloudflare's edge), the error is logged and dev server startup continues unaffected.
- Playground with a working Storybook integration - sample components and stories that exercise the tunnel URL at runtime, ready to tunnel with `storybook: true`.
- CI pipeline covering lint (ESLint), type-check (`vue-tsc`), unit tests (Vitest), and build, with conventional-commit enforcement and `changelogen`-driven releases.

[0.1.0]: https://github.com/Decipher/nuxt-cloudflared-tunnel/releases/tag/v0.1.0
