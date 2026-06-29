import type { Meta, StoryObj } from '@storybook/vue3'
import TunnelBadge from './TunnelBadge.vue'

const meta = {
  title: 'Playground/TunnelBadge',
  component: TunnelBadge,
  tags: ['autodocs'],
} satisfies Meta<typeof TunnelBadge>

export default meta
type Story = StoryObj<typeof meta>

export const Active: Story = {
  args: {
    isTunnel: true,
    tunnelUrl: 'https://random-words.trycloudflare.com',
  },
}

export const Inactive: Story = {
  args: {
    isTunnel: false,
    tunnelUrl: undefined,
  },
}
