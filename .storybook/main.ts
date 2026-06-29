import type { StorybookConfig } from '@storybook-vue/nuxt'

const config: StorybookConfig = {
  stories: ['../playground/**/*.stories.ts'],
  framework: {
    name: '@storybook-vue/nuxt',
    options: {
      nuxtConfigPath: '../playground/nuxt.config.ts',
    },
  },
  viteFinal(config) {
    // Storybook runs its own Vite server. Cloudflare Quick Tunnels use random
    // *.trycloudflare.com hostnames that Vite rejects by default, so allow them
    // (the Nuxt side is handled by the cloudflared-tunnel module).
    config.server ??= {}
    config.server.allowedHosts = true
    return config
  },
}

export default config
