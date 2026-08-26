import { cache } from 'react'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getPostById } from '@/lib/api'
import { articlePath, fetchArticleBody, isArticle, postIdFromSlug, readingTimeLabel } from '@/lib/article'
import { renderArticleMarkdown } from '@/lib/markdown'
import { resolveIPFSImageUrl } from '@/lib/storageHelper'
import PageTitle from '@/components/PageTitle'
import Profile from '@/components/Profile'
import styles from './page.module.scss'

/* Deduplicate the fetch so generateMetadata and Page share one request per render */
const fetchPost = cache((networkId, postId) => getPostById(networkId, postId, null))

/**
 * The post behind an article URL, or null when the address resolves to something that is not one.
 * Every caller here treats "not an article" and "no such post" the same way — a 404 — because a
 * plain post reached through /articles has its own canonical home at /networks.
 */
const resolveArticle = cache(async (networkId, slug) => {
  const postId = postIdFromSlug(slug)
  if (!postId) return null

  try {
    const response = await fetchPost(networkId, postId)
    const post = response?.data
    if (!post || post.is_deleted) return null

    const content = typeof post.content === 'string' ? JSON.parse(post.content) : post.content
    if (!isArticle(content)) return null

    return { post, postId, article: content.article }
  } catch {
    return null
  }
})

/* created_at arrives as either "2025-12-07 17:37:36" or a unix timestamp, depending on the path
   that indexed it. Structured data and <time> both need an ISO string. */
function toIsoDate(createdAt) {
  if (createdAt === null || createdAt === undefined || createdAt === '') return null

  const ms = typeof createdAt === 'string' ? Date.parse(createdAt.replace(' ', 'T')) : Number(createdAt) * 1000
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

const dateFormat = new Intl.DateTimeFormat('en', { year: 'numeric', month: 'long', day: 'numeric' })

export async function generateMetadata({ params }, parent) {
  const parentMetadata = await parent
  const { networkId, slug } = await params

  const resolved = await resolveArticle(networkId, slug)
  if (!resolved) {
    return { title: 'Article not found', description: parentMetadata.description || 'This article could not be found.' }
  }

  const { article, postId } = resolved
  const description = article.subtitle || article.excerpt || parentMetadata.description
  /* The canonical address is the one articlePath builds — a reader who arrives on a stale slug
     (the author edited the title) still lands here, and this is what keeps the two URLs from
     competing as duplicates in an index. */
  const canonical = articlePath(networkId, postId, article.title)
  /* jpeg rather than webp: several social crawlers still mishandle webp cards */
  const cover = article.cover ? resolveIPFSImageUrl(article.cover, { width: 1200, format: 'jpeg' }) : null
  const images = cover ? [{ url: cover, width: 1200, height: 630, alt: article.title }] : undefined

  return {
    title: article.title,
    description,
    alternates: { canonical },
    /* Next replaces the parent openGraph wholesale rather than merging it, so siteName and
       locale have to be restated here or the card loses its branding */
    openGraph: {
      type: 'article',
      url: canonical,
      siteName: process.env.NEXT_PUBLIC_NAME,
      locale: 'en_US',
      title: article.title,
      description,
      ...(images ? { images } : {}),
      ...(resolved.post?.created_at ? { publishedTime: toIsoDate(resolved.post.created_at) } : {}),
      ...(article.tags?.length ? { tags: article.tags } : {}),
    },
    twitter: {
      card: cover ? 'summary_large_image' : 'summary',
      title: article.title,
      description,
      ...(images ? { images } : {}),
    },
  }
}

export default async function Page({ params }) {
  const { networkId, slug } = await params

  const resolved = await resolveArticle(networkId, slug)
  if (!resolved) notFound()

  const { post, postId, article } = resolved

  /* The one fetch the feed never pays for. It happens here, on the server, so the prose is in the
     delivered HTML — an article a crawler cannot read defeats the point of publishing one. */
  const markdown = await fetchArticleBody(article.bodyCid)
  const html = markdown ? renderArticleMarkdown(markdown) : ''

  const cover = article.cover ? resolveIPFSImageUrl(article.cover, { width: 1600 }) : null
  const publishedIso = toIsoDate(post.created_at)
  const postHref = `/networks/${networkId}/${postId}`

  /* Structured data: the reason a search engine shows a byline and a date beside the result
     rather than a bare link. Kept in sync with generateMetadata above by reading the same fields. */
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: article.title,
    ...(article.subtitle || article.excerpt ? { description: article.subtitle || article.excerpt } : {}),
    ...(cover ? { image: [cover] } : {}),
    ...(publishedIso ? { datePublished: publishedIso, dateModified: publishedIso } : {}),
    author: { '@type': 'Person', name: post.display_name || post.wallet_address },
    ...(article.wordCount ? { wordCount: article.wordCount } : {}),
    ...(article.tags?.length ? { keywords: article.tags.join(', ') } : {}),
    mainEntityOfPage: { '@type': 'WebPage', '@id': articlePath(networkId, postId, article.title) },
  }

  return (
    <>
      <PageTitle name={article.title} changeDocumentTitle={false} />

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div className={styles.page}>
        {/* The container class has to sit on a div — Global.scss scopes the width map to
            `div[class*='__container']`, so putting it on the <article> silently did nothing and
            the prose ran the full width of the viewport, under the fixed sidebar. */}
        <div className="__container" data-width="medium">
          <article className={styles.article}>
            <header className={styles.article__header}>
              <h1 className={styles.article__title} dir="auto">
                {article.title}
              </h1>

              {article.subtitle && (
                <p className={styles.article__subtitle} dir="auto">
                  {article.subtitle}
                </p>
              )}

              <div className={styles.article__byline}>
                <Profile creator={post.wallet_address} networkId={post.network_id} variant="fullWithoutTime" />

                <div className={styles.article__meta}>
                  {publishedIso && <time dateTime={publishedIso}>{dateFormat.format(new Date(publishedIso))}</time>}
                  <span aria-hidden="true">·</span>
                  <span>{readingTimeLabel(article.wordCount)}</span>
                </div>
              </div>
            </header>

            {cover && (
              <figure className={styles.article__cover}>
                {/* Not next/image: the source is an arbitrary IPFS CID already resized by the
                    proxy, so the optimizer would only add a second re-encode in front of it */}
                <img src={cover} alt="" />
              </figure>
            )}

            {html ? (
              <div className={styles.article__body} dir="auto" dangerouslySetInnerHTML={{ __html: html }} />
            ) : (
              <p className={styles.article__unavailable}>
                The body of this article could not be loaded right now — no IPFS gateway would serve it. The post itself is
                still on {post.network_name || 'chain'}, so this is a temporary failure rather than a deleted article.
              </p>
            )}

            {article.tags?.length > 0 && (
              <ul className={styles.article__tags}>
                {article.tags.map((tag) => (
                  <li key={tag}>{tag}</li>
                ))}
              </ul>
            )}

            {/* Discussion, likes and tips live on the post — this article IS that post, so there is
                no second comment system to build and nothing to keep in sync. */}
            <footer className={styles.article__footer}>
              <Link href={postHref} className={styles.article__discuss}>
                Reply, tip or repost this article
              </Link>
            </footer>
          </article>
        </div>
      </div>
    </>
  )
}
