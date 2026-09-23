import ChatEmbed from './ChatEmbed'

export const metadata = {
  title: 'Chat',
  robots: { index: false, follow: false },
}

const THEMES = new Set(['light', 'dark'])

/** The public chat room as framed by public/chat-widget.js on an allowlisted site. */
export default async function ChatEmbedPage({ searchParams }) {
  const { theme } = await searchParams
  return <ChatEmbed theme={THEMES.has(theme) ? theme : null} />
}
