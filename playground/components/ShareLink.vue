<script setup lang="ts">
import { ref } from 'vue'

const props = withDefaults(defineProps<{
  tunnelUrl?: string
  label?: string
}>(), {
  tunnelUrl: undefined,
  label: 'Copy tunnel URL',
})

const copied = ref(false)

async function copy() {
  if (!props.tunnelUrl) {
    return
  }
  try {
    await navigator.clipboard.writeText(props.tunnelUrl)
    copied.value = true
    setTimeout(() => {
      copied.value = false
    }, 2000)
  }
  catch {
    // Clipboard API unavailable (e.g. insecure context). No-op.
  }
}
</script>

<template>
  <button
    class="share-link"
    :class="{
      'share-link--copied': copied,
      'share-link--disabled': !props.tunnelUrl,
    }"
    type="button"
    :disabled="!props.tunnelUrl"
    @click="copy"
  >
    <span v-if="copied">Copied!</span>
    <span v-else>{{ props.label }}</span>
  </button>
</template>

<style scoped>
.share-link {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 1rem;
  border-radius: 0.5rem;
  border: 1px solid transparent;
  font-size: 0.9rem;
  font-family: inherit;
  cursor: pointer;
  background: #00DC82;
  color: #020420;
  transition: background 0.15s ease;
}

.share-link:hover:not(:disabled) {
  background: #00c172;
}

.share-link--copied {
  background: #020420;
  color: #00DC82;
}

.share-link--disabled {
  background: #f4f4f5;
  color: #a1a1aa;
  border-color: #e4e4e7;
  cursor: not-allowed;
}
</style>
