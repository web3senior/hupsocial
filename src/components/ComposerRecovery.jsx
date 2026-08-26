'use client'

import NewPost from '@/components/NewPost'
import { useComposerStore } from '@/stores/useComposerStore'

/**
 * Puts a rejected submission's composer back on screen.
 *
 * Mounted once in the shell rather than at whatever opened the composer in the first place:
 * the author left that screen the moment the transaction was sent — the post they were
 * replying to, the community they were writing in — and a transaction that reverts a few
 * seconds later has to find them wherever they went next.
 */
export default function ComposerRecovery() {
  const recovery = useComposerStore((state) => state.recovery)
  const clearRecovery = useComposerStore((state) => state.clearRecovery)

  if (!recovery) return null

  return <NewPost key={recovery.id} {...recovery.props} restoreState={recovery.state} onClose={clearRecovery} />
}
