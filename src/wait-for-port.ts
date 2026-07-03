import { connect } from 'node:net'

export interface WaitForPortOptions {
  /** Maximum time to wait, in ms (default 5000). */
  timeout?: number
  /** Time between connection attempts, in ms (default 500). */
  interval?: number
  /** Host to probe (default '127.0.0.1'). */
  host?: string
}

/**
 * Poll a local TCP port until it accepts a connection or the deadline passes.
 *
 * Used to decide whether a secondary tunnel target (e.g. a Storybook dev
 * server) is actually running before opening a Quick Tunnel to it. Resolves as
 * soon as the port is reachable - rather than after a fixed delay - and
 * resolves `false` on timeout so the caller can skip opening a tunnel to a
 * dead port.
 *
 * @param port - TCP port to probe.
 * @param options - Polling options.
 * @param options.timeout - Maximum time to wait, in ms (default 5000).
 * @param options.interval - Time between connection attempts, in ms (default 500).
 * @param options.host - Host to probe (default '127.0.0.1').
 * @returns `true` if the port accepted a connection, `false` on timeout.
 */
export async function waitForPort(
  port: number,
  { timeout = 5_000, interval = 500, host = '127.0.0.1' }: WaitForPortOptions = {},
): Promise<boolean> {
  const deadline = Date.now() + timeout

  return new Promise<boolean>((resolve) => {
    const attempt = (): void => {
      const socket = connect({ port, host })

      const done = (result: boolean): void => {
        socket.removeAllListeners()
        socket.destroy()
        resolve(result)
      }

      socket.once('connect', () => done(true))
      socket.once('error', () => {
        if (Date.now() >= deadline) {
          resolve(false)
          return
        }
        setTimeout(attempt, interval)
      })
    }

    attempt()
  })
}
