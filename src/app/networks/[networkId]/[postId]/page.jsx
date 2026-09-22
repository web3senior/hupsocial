import { cache } from 'react'
import { readPostForPage } from '@/lib/postRows'
import { commentsPageUrl } from '@/lib/commentsRequest'
import { summarizePost } from '@/lib/postSummary'
import PageTitle from '@/components/PageTitle'
import PreloadFetch from '@/components/PreloadFetch'
import PostDetails from './_components/PostDetails'
import { postHeaderProps } from './_components/postHeader'
import styles from './page.module.scss'

// Deduplicate the read so generateMetadata and Page share one query per render. Straight from
// the database rather than over HTTP to our own API: the post is what this page is, so it is
// rendered here and shipped in the HTML instead of fetched again once the client wakes up. A
// failed read renders the page without a row and the client fetches as it always could.
const fetchPost = cache((networkId, postId) => readPostForPage(networkId, postId).catch(() => null))

/* Long enough to read as a sentence, short enough that no crawler truncates it mid-card */
const TITLE_MAX = 70
const DESCRIPTION_MAX = 200

export async function generateMetadata({ params }, parent) {
  // Fetch and resolve the parent metadata object
  const parentMetadata = await parent

  // Extract required parameters for fetching the dynamic post
  const { networkId, postId } = await params

  const notFound = {
    title: 'Post Not Found',
    description: parentMetadata.description || 'The requested post was not found.',
  }

  try {
    const item = await fetchPost(networkId, postId)
    if (!item) return notFound

    /* summarizePost reads the text element by type rather than by index — an NFT listing or a
       media-only post does not necessarily lead with words — and describes the post when it
       has none of its own */
    const title = summarizePost(item, TITLE_MAX)
    const description = summarizePost(item, DESCRIPTION_MAX)
    const postUrl = `/networks/${networkId}/${postId}`

    /* No images here on purpose. opengraph-image.jsx in this segment supplies og:image, its
       type, dimensions and alt, and file-based metadata overrides anything set here anyway.
       Leaving `images` off twitter is what lets Next mirror that same card into twitter:image
       (resolve-metadata only auto-fills twitter when the level has no `images` key of its own),
       so the two never drift apart. */
    const metadata = {
      title,
      description,

      /* The root layout pins canonical to '/', which every page inherits. X honours
         rel=canonical, so without this override each shared post resolved back to the
         home page and X rendered the generic site card instead of the post's own. */
      alternates: { canonical: postUrl },

      /* Next replaces the parent openGraph wholesale rather than merging it, so siteName
         and locale have to be restated here or the card loses its branding */
      openGraph: {
        type: 'article',
        url: postUrl,
        siteName: process.env.NEXT_PUBLIC_NAME,
        locale: 'en_US',
        title,
        description,
      },

      // Every post now has a generated 1200x630 card, so the large format always applies
      twitter: { card: 'summary_large_image', title, description },
    }

    return metadata
  } catch (error) {
    // Provide safe layout fallbacks if runtime processing encounters failures
    return notFound
  }
}

export default async function Page({ params }) {
  const { networkId, postId } = await params
  const post = await fetchPost(networkId, postId)

  // The thread and the supporters strip are the first things the client asks for once it
  // hydrates. Naming them in the document lets the browser start both while it is still parsing
  // the HTML, which lands them about a hydration earlier. PreloadFetch itself keeps this to
  // document loads; a client navigation has the thread cached or already in flight.
  const preloads = []
  if (post) {
    const threadId = Number(post.is_repost) > 0 ? post.is_repost : postId
    preloads.push(commentsPageUrl(networkId, threadId))
    if (Number(post.total_tips) > 0) preloads.push(`/api/v1/networks/${networkId}/${threadId}/tips`)
  }

  return (
    <>
      {preloads.length > 0 && <PreloadFetch hrefs={preloads} />}
      <PageTitle name={`Post`} changeDocumentTitle={false} containerWidth={`small`} {...postHeaderProps(post, networkId)} />
      <div className={`${styles.page}`}>
        <PostDetails networkId={networkId} postId={postId} initialPost={post} />
      </div>
    </>
  )
}
