<script setup lang="ts">
const props = withDefaults(defineProps<{
  tunnelUrl?: string
  isTunnel?: boolean
}>(), {
  tunnelUrl: undefined,
  isTunnel: false,
})
</script>

<template>
  <div
    class="tunnel-badge"
    :class="props.isTunnel ? 'tunnel-badge--active' : 'tunnel-badge--inactive'"
    role="status"
  >
    <span class="tunnel-badge__dot" />
    <span class="tunnel-badge__label">
      {{ props.isTunnel ? 'Tunnel active' : 'No tunnel' }}
    </span>
    <code
      v-if="props.isTunnel && props.tunnelUrl"
      class="tunnel-badge__url"
    >{{ props.tunnelUrl }}</code>
  </div>
</template>

<style scoped>
.tunnel-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.35rem 0.75rem;
  border-radius: 9999px;
  font-size: 0.875rem;
  font-family: inherit;
  border: 1px solid transparent;
}

.tunnel-badge__dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 9999px;
  flex-shrink: 0;
}

.tunnel-badge--active {
  background: color-mix(in srgb, #00DC82 15%, transparent);
  border-color: color-mix(in srgb, #00DC82 40%, transparent);
  color: #035c40;
}

.tunnel-badge--active .tunnel-badge__dot {
  background: #00DC82;
  box-shadow: 0 0 0 3px color-mix(in srgb, #00DC82 25%, transparent);
}

.tunnel-badge--inactive {
  background: #f4f4f5;
  border-color: #e4e4e7;
  color: #71717a;
}

.tunnel-badge--inactive .tunnel-badge__dot {
  background: #d4d4d8;
}

.tunnel-badge__url {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.8125rem;
  background: rgba(0, 0, 0, 0.06);
  padding: 0.1rem 0.4rem;
  border-radius: 0.375rem;
}
</style>
