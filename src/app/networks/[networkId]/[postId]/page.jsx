import { cache } from 'react'
import { getPostById } from '@/lib/api'
import { summarizePost } from '@/lib/postSummary'
import PageTitle from '@/components/PageTitle'
import PostDetails from './_components/PostDetails'
import styles from './page.module.scss'

// Deduplicate the fetch so generateMetadata and Page share one request per render
const fetchPost = cache((networkId, postId) => getPostById(networkId, postId, null))

/* Long enough to read as a sentence, short enough that no crawler truncates it mid-card */
const TITLE_MAX = 70
const DESCRIPTION_MAX = 200

export async function generateMetadata({ params }, parent) {
  // Fetch and resolve the parent metadata object
  const parentMetadata = await parent

  // Extract required parameters for fetching the dynamic post
  const { networkId, postId } = await params

  try {
    // Attempt to fetch post data from the external source
    const post = await fetchPost(networkId, postId)
    const item = post?.data

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
    return {
      title: 'Post Not Found',
      description: parentMetadata.description || 'The requested post was not found.',
    }
  }
}

export default async function Page({ params }) {
  const resolvedParams = await params
  const { networkId, postId } = resolvedParams

  return (
    <>
      <PageTitle name={`Post`} changeDocumentTitle={false} />
      <div className={`${styles.page}`}>
        <PostDetails networkId={networkId} postId={postId} />
      </div>
    </>
  )
}
