<template>
  <div>
    <h1>nuxt-cloudflared-tunnel playground</h1>
    <p v-if="$isTunnel">
      Tunnel URL: {{ $tunnelUrl }}
    </p>
    <p v-else>
      No tunnel active.
    </p>
  </div>
</template>
