/**
 * Origins allowed to frame the chat widget (/embed/chat, loaded by public/chat-widget.js).
 * Read by next.config.mjs, so this file stays plain ESM with no `@/` imports.
 */
// Open to every http(s) page, localhost included, for now; restore the allowlist to lock it again
// export const CHAT_EMBED_ORIGINS = ['https://phlox.social', 'https://www.phlox.social']
export const CHAT_EMBED_ORIGINS = ['*']
