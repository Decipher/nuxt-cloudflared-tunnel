import type { Meta, StoryObj } from '@storybook/vue3'
import ShareLink from './ShareLink.vue'

const meta = {
  title: 'Playground/ShareLink',
  component: ShareLink,
  tags: ['autodocs'],
} satisfies Meta<typeof ShareLink>

export default meta
type Story = StoryObj<typeof meta>

export const Ready: Story = {
  args: {
    tunnelUrl: 'https://random-words.trycloudflare.com',
    label: 'Copy tunnel URL',
  },
}

export const NoTunnel: Story = {
  args: {
    tunnelUrl: undefined,
    label: 'Copy tunnel URL',
  },
}
