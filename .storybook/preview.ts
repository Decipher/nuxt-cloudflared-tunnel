import type { Decorator, Preview } from '@storybook/vue3'
import { defineComponent, h } from 'vue'

const withPlaygroundFont: Decorator = story =>
  defineComponent({
    setup() {
      return () =>
        h('div', { style: 'font-family: ui-sans-serif, system-ui, sans-serif;' }, [
          h(story()),
        ])
    },
  })

const preview: Preview = {
  decorators: [withPlaygroundFont],
  parameters: {
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    layout: 'centered',
  },
}

export default preview
