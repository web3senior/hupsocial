// ■■■ [Notification Stream Router] ■■■
import { EventEmitter } from 'events';

// Global event bus to communicate between your webhook/indexer route and this stream
global.notificationEvents = global.notificationEvents || new EventEmitter();
const eventBus = global.notificationEvents;

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const walletAddress = searchParams.get('wallet')?.toLowerCase();

    if (!walletAddress) {
        return new Response('Wallet address required', { status: 400 });
    }

    // Set up headers for Server-Sent Events
    const responseStream = new TransformStream();
    const writer = responseStream.writable.getWriter();
    const encoder = new TextEncoder();

    // Define the handler to catch updates from your application backend
    const handleNotification = (notificationItem) => {
        const actionableTypes = [
            'post_received_comment',
            'post_received_like',
            'post_received_repost'
        ];

        // Process only valid actions originating from other users
        if (!actionableTypes.includes(notificationItem.action_type)) return;
        if (notificationItem.recipient_wallet_address.toLowerCase() === notificationItem.actor_wallet_address.toLowerCase()) return;

        // Ensure the event belongs to this specific connected wallet
        if (notificationItem.recipient_wallet_address.toLowerCase() === walletAddress) {
            const payload = {
                id: notificationItem.id,
                title: notificationItem.title,
                message: notificationItem.message,
                actionUrl: notificationItem.action_url,
                networkName: notificationItem.data?.network_name || 'LUKSO',
                createdAt: notificationItem.created_at
            };

            // SSE requires specific string layout format: "data: {JSON}\n\n"
            writer.write(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        }
    };

    // Listen to your indexer's events globally
    eventBus.on('new_notification', handleNotification);

    // Clean up when connection closes or tab is closed
    request.signal.addEventListener('abort', () => {
        eventBus.off('new_notification', handleNotification);
        writer.close();
    });

    return new Response(responseStream.readable, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
        },
    });
}