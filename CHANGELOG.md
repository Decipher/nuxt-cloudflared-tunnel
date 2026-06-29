# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0]

### Added

- Initial extraction of `nuxt-cloudflared-tunnel` as a standalone Nuxt module.
- Cloudflare Quick Tunnel started automatically on `nuxt dev`, via `untun`.
- Tunnel URL exposed at runtime through `useRuntimeConfig()` and a
  `$tunnelUrl` / `$isTunnel` plugin.
- `enabled`, `port`, and `log` module options.
- Lint, test, and build CI pipeline.

### Fixed

- `prepare` script added for git-dependency installs, and the package
  `repository` URL corrected.

[0.1.0]: https://github.com/Decipher/nuxt-cloudflared-tunnel/releases/tag/v0.1.0
