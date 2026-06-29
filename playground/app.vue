<script setup lang="ts">
import TunnelBadge from './components/TunnelBadge.vue'
import ShareLink from './components/ShareLink.vue'

const { $tunnelUrl, $isTunnel } = useNuxtApp<{ $tunnelUrl?: string, $isTunnel?: boolean }>()
</script>

<template>
  <div class="playground">
    <h1>nuxt-cloudflared-tunnel</h1>
    <p class="playground__hint">
      Playground for the Cloudflare Quick Tunnel module.
    </p>

    <div class="playground__row">
      <TunnelBadge
        :tunnel-url="$tunnelUrl"
        :is-tunnel="$isTunnel"
      />
    </div>

    <div class="playground__row">
      <ShareLink :tunnel-url="$tunnelUrl" />
    </div>

    <p
      v-if="!$isTunnel"
      class="playground__muted"
    >
      Run <code>pnpm dev</code> to start a tunnel.
    </p>
  </div>
</template>

<style scoped>
.playground {
  font-family: ui-sans-serif, system-ui, sans-serif;
  max-width: 42rem;
  margin: 3rem auto;
  padding: 0 1.5rem;
  color: #020420;
}

.playground h1 {
  font-size: 1.75rem;
  margin: 0 0 0.25rem;
}

.playground__hint {
  color: #71717a;
  margin: 0 0 2rem;
}

.playground__row {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1rem;
}

.playground__muted {
  margin-top: 1.5rem;
  color: #71717a;
  font-size: 0.9rem;
}

.playground code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  background: rgba(0, 0, 0, 0.06);
  padding: 0.1rem 0.35rem;
  border-radius: 0.25rem;
}
</style>
