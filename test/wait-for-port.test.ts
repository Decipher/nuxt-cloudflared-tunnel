import { createServer, type AddressInfo, type Server } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { waitForPort } from '../src/wait-for-port'

describe('waitForPort', () => {
  const servers: Server[] = []

  afterEach(async () => {
    await Promise.all(
      servers.map(server => new Promise<void>(resolve => server.close(() => resolve()))),
    )
    servers.length = 0
  })

  it('resolves false when nothing is listening on the port', async () => {
    const up = await waitForPort(59999, { timeout: 300, interval: 100 })

    expect(up).toBe(false)
  })

  it('resolves true immediately when the port is already accepting connections', async () => {
    const server = createServer()
    servers.push(server)
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve)
    })
    const { port } = server.address() as AddressInfo

    const start = Date.now()
    const up = await waitForPort(port, { timeout: 2000, interval: 100 })

    expect(up).toBe(true)
    expect(Date.now() - start).toBeLessThan(500)
  })

  it('keeps polling until the port becomes available', async () => {
    // Reserve an ephemeral port, then release it so the number can be reused.
    const holder = createServer()
    await new Promise<void>(resolve => holder.listen(0, '127.0.0.1', resolve))
    const { port } = holder.address() as AddressInfo
    await new Promise<void>(resolve => holder.close(() => resolve()))

    // Begin polling while nothing is listening yet.
    const result = waitForPort(port, { timeout: 1500, interval: 100 })

    // Bring the port up partway through the polling window.
    const server = createServer()
    servers.push(server)
    setTimeout(() => server.listen(port, '127.0.0.1'), 400)

    await expect(result).resolves.toBe(true)
  })
})
