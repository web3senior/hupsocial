'use client'

import { useMemo } from 'react'
import clsx from 'clsx'
import { BookmarkSimpleIcon, ChartBarIcon, ChatCircleIcon, HeartIcon, RepeatIcon, UploadSimpleIcon } from '@phosphor-icons/react'
import Profile from '@/components/Profile'
import MediaGallery from '@/components/Gallery'
import { TipIcon } from '@/components/Icons'
import { renderMarkdown } from '@/lib/markdown'
// The action bar is the real one's stylesheet, not a copy of it: the icons have to sit exactly
// where the live card will put them, or the handover shifts the row under the author's cursor.
import postStyles from './Post.module.scss'
import styles from './PendingPost.module.scss'

// Attachments (a quote, a poll, a listing, a market…) render from live data the real card
// fetches by id. The ghost has no id yet, so it stands in for them with a block of roughly the
// right weight rather than firing lookups for a post that does not exist.
const ATTACHMENT_KEYS = ['quoteOf', 'nftListing', 'predictMarket', 'tokenLaunch', 'nftDrop', 'miniApp', 'poll', 'article']

const getElement = (content, type) => content?.elements?.find((element) => element?.type === type)

/**
 * The author's own post, drawn where it is about to land while the chain and the indexer catch
 * up. Faded and inert on purpose: it is a preview of a row, not a row — nothing in it can be
 * liked, opened or replied to until the real card takes its place.
 *
 * Everything shown here comes from the payload the composer already pinned, so the text and the
 * media are the real ones, not placeholders.
 */
export default function PendingPost({ entry }) {
  const { content, author, networkId, createdAt, status } = entry

  const text = getElement(content, 'text')?.data?.text || ''
  const media = getElement(content, 'media')?.data?.items || []
  const hasAttachment = useMemo(() => ATTACHMENT_KEYS.some((key) => content?.[key]), [content])

  return (
    <article className={clsx(styles['pending-post'], 'flex flex-column')} aria-hidden="true" data-status={status}>
      <header className="flex align-items-start justify-content-between w-100">
        <Profile creator={author} createdAt={createdAt} networkId={networkId} />
      </header>

      <div className={styles['pending-post__body']}>
        {text && <div className={styles['pending-post__text']} dir="auto" dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />}

        {media.length > 0 && (
          <div className={styles['pending-post__media']}>
            <MediaGallery data={media} />
          </div>
        )}

        {hasAttachment && <div className={clsx(styles['pending-post__attachment'], 'shimmer')} />}
      </div>

      {/* Every counter starts empty on a post this new, so the live bar looks the same — these
          are the same icons in the same order, inert until the real card replaces them. */}
      <footer className={clsx(postStyles.post__footer, styles['pending-post__footer'])}>
        <div className={clsx(postStyles.post__actions, 'flex flex-row align-items-center justify-content-between')}>
          <div className="flex flex-row align-items-center justify-content-start" style={{ gap: '4px' }}>
            <button type="button" tabIndex={-1} data-action="like">
              <HeartIcon width={18} height={18} />
            </button>
            <button type="button" tabIndex={-1} data-action="comment">
              <ChatCircleIcon width={17} height={17} />
            </button>
            <button type="button" tabIndex={-1} data-action="repost">
              <RepeatIcon width={20} height={20} />
            </button>
            <button type="button" tabIndex={-1} data-action="tip">
              <TipIcon />
            </button>
            <button type="button" tabIndex={-1} data-action="view">
              <ChartBarIcon width={17} height={17} />
            </button>
          </div>
          <div className="flex align-items-center gap-025">
            <button type="button" tabIndex={-1} data-action="bookmark">
              <BookmarkSimpleIcon width={17} height={17} />
            </button>
            <button type="button" tabIndex={-1} data-action="share">
              <UploadSimpleIcon width={17} height={17} />
            </button>
          </div>
        </div>
      </footer>
    </article>
  )
}
