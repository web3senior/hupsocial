import { isWalletAddress } from '@/lib/address'
import { subscribeNotifications } from '@/lib/notificationStream'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Proxies and load balancers close a silent connection after ~30-60s; a comment line every
// 25s keeps it open without waking the client's message handler.
const HEARTBEAT_MS = 25_000
// How long EventSource waits before reconnecting after the connection drops
const RETRY_MS = 5000

const encoder = new TextEncoder()

/**
 * Server-Sent Events feed of new notifications for one wallet, the live half of the toasts
 * (lib/notificationStream.js holds the ticker). Read access matches GET /api/v1/notifications,
 * which is already public per wallet.
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const wallet = searchParams.get('wallet')

  if (!isWalletAddress(wallet)) {
    return new Response('Valid wallet address is required', { status: 400 })
  }

  let cleanup = () => {}

  const stream = new ReadableStream({
    start(controller) {
      const write = (chunk) => {
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          cleanup()
        }
      }

      write(`retry: ${RETRY_MS}\n: connected\n\n`)

      const unsubscribe = subscribeNotifications(wallet, (notification) => {
        write(`id: ${notification.id}\nevent: notification\ndata: ${JSON.stringify(notification)}\n\n`)
      })
      const heartbeat = setInterval(() => write(': ping\n\n'), HEARTBEAT_MS)

      let closed = false
      cleanup = () => {
        if (closed) return
        closed = true
        clearInterval(heartbeat)
        unsubscribe()
        try {
          controller.close()
        } catch {
          /* already closed by the runtime */
        }
      }

      request.signal.addEventListener('abort', cleanup, { once: true })
    },
    cancel() {
      cleanup()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // nginx buffers proxied responses by default, which would hold every event back
      'X-Accel-Buffering': 'no',
    },
  })
}
