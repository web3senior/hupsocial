import pool from '@/lib/db'

/** Resolve attachment text on the server; poll content stores only an id and chain. */
export async function getPostPreviewText(post) {
  const bodyText = post?.content?.elements?.find((element) => element?.type === 'text')?.data?.text || ''
  const poll = post?.content?.poll
  if (!poll || !/^[1-9]\d*$/.test(String(poll.chainId)) || !/^\d+$/.test(String(poll.pollId))) return bodyText

  try {
    const [rows] = await pool.execute(
      'SELECT question FROM polls WHERE network_id = ? AND poll_id = ? LIMIT 1',
      [String(poll.chainId), String(poll.pollId)],
    )
    const question = rows[0]?.question?.trim()
    // Lead with the question so a long caption cannot push it out of the preview.
    return question ? [question, bodyText].filter(Boolean).join('\n\n') : bodyText
  } catch (error) {
    console.warn('[post-preview] Poll question lookup failed:', error.message)
    return bodyText
  }
}
