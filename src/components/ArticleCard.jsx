'use client'

import Link from 'next/link'
import clsx from 'clsx'
import { ArticleIcon, ClockIcon } from '@phosphor-icons/react'
import { articlePath, readingTimeLabel } from '@/lib/article'
import { resolveIPFSImageUrl } from '@/lib/storageHelper'
import { handleBrokenImage } from '@/lib/utils'
import styles from './ArticleCard.module.scss'

/**
 * Article Card
 *
 * The feed surface of a long-form post. Everything it draws comes out of the post's own content
 * JSON — title, cover, excerpt, word count — so the card costs no fetch and no request waterfall
 * in a timeline. The body lives under its own CID and is read only by the reader page, which is
 * the whole reason a 10,000-word article does not weigh down the feed that lists it.
 *
 * @param {Object} props
 * @param {Object} props.article The post's `article` content reference.
 * @param {string|number} props.networkId Chain the post lives on — post ids are per-network.
 * @param {string|number} props.postId
 * @param {boolean} [props.compact] Drops the cover. For quoted posts, which are already nested.
 */
const ArticleCard = ({ article, networkId, postId, compact = false }) => {
  if (!article?.title || !article?.bodyCid) return null

  const href = articlePath(networkId, postId, article.title)
  /* Cover art is decorative and sits behind text at card width — a rung well short of the
     original keeps a 4MB camera JPEG out of the timeline. */
  const cover = article.cover ? resolveIPFSImageUrl(article.cover, { width: 800 }) : null
  const showCover = Boolean(cover) && !compact

  return (
    <Link
      href={href}
      className={clsx(styles.articleCard, compact && styles.articleCard_compact)}
      /* The card sits inside a post whose own click opens the post detail — this link goes
         somewhere else, so it must not bubble into that handler. */
      onClick={(e) => e.stopPropagation()}
    >
      {showCover && (
        <div className={styles.articleCard__cover}>
          <img src={cover} alt="" loading="lazy" onError={handleBrokenImage} />
        </div>
      )}

      <div className={styles.articleCard__body}>
        <div className={styles.articleCard__kicker}>
          <ArticleIcon size={14} weight="fill" />
          <span>Article</span>
        </div>

        <h3 className={styles.articleCard__title}>{article.title}</h3>

        {article.subtitle && <p className={styles.articleCard__subtitle}>{article.subtitle}</p>}

        {!compact && article.excerpt && <p className={styles.articleCard__excerpt}>{article.excerpt}</p>}

        <div className={styles.articleCard__meta}>
          <ClockIcon size={13} />
          <span>{readingTimeLabel(article.wordCount)}</span>

          {article.tags?.length > 0 && (
            <span className={styles.articleCard__tags}>
              {article.tags.map((tag) => (
                <span key={tag} className={styles.articleCard__tag}>
                  {tag}
                </span>
              ))}
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}

export default ArticleCard
