import { getPostById } from '@/lib/api'
import PageTitle from '@/components/PageTitle'
import PostDetails from './_components/PostDetails'
import { notFound } from 'next/navigation'
import styles from './page.module.scss'
import { resolveStorageUrl } from '@/lib/storageHelper'

export async function generateMetadata({ params }, parent) {
  // Fetch and resolve the parent metadata object
  const parentMetadata = await parent

  // Extract required parameters for fetching the dynamic post
  const { networkId, postId } = await params

  try {
    // Attempt to fetch post data from the external source
    const post = await getPostById(networkId, postId, null)
    const item = post?.data

    // Initialize an array to hold mapped images for metadata tags
    let images = []

    const mediaElement = item?.content?.elements?.find((el) => el?.type === 'media')
    if (mediaElement?.data?.items?.length > 0) {
      mediaElement.data.items.forEach((mediaItem) => {
        if (mediaItem.type === 'image') {
          const url = mediaItem.cid.startsWith('http') ? mediaItem.cid : resolveStorageUrl(mediaItem.cid)
          if (url) {
            images.push({
              url,
              width: mediaItem.width || 1200,
              height: mediaItem.height || 630,
              alt: mediaItem.alt || 'Post Image',
            })
          }
        }
      })
    }

    // Fall back to empty text string if body content cannot be resolved
    const bodyText = post?.data?.content?.elements?.[0]?.data?.text || ''

    const ogImages = images.length > 0
      ? images
      : [{ url: '/open-graph.png', width: 1200, height: 630, alt: 'Open Graph Image' }]

    // Construct unified dynamic metadata configuration payload
    const metadata = {
      // Slice the first 60 characters for the SEO title
      title: bodyText.slice(0, 60).trim() || 'Post Details',

      // Slice the first 160 characters for the description, then fall back if empty
      description: bodyText.slice(0, 160).trim() || parentMetadata.description || 'View the details of this post on our platform.',

      // Build out Open Graph specific data representations
      openGraph: { images: ogImages },

      // Always use summary_large_image since we always have an OG image now
      twitter: { card: 'summary_large_image', images: ogImages },
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

export default async function Page({ params, searchParams }) {
  // Resolve params and searchParams in parallel to avoid waterfalls
  const [resolvedParams, resolvedSearchParams] = await Promise.all([params, searchParams])

  const { networkId, postId } = resolvedParams
  const advancedView = resolvedSearchParams?.advancedView === 'true'

  // Fetch target post data directly on the server
  let post = null
  try {
    post = await getPostById(networkId, postId, null)
  } catch (error) {
    console.error(`Failed to fetch post ${postId}:`, error)
  }

  // Trigger Next.js native 404 page if the post explicitly doesn't exist
  if (!post || !post.data) {
    notFound()
  }

  return (
    <>
      <PageTitle name={`Post`} changeDocumentTitle={false} />
      <div className={`${styles.page}`}>
        <PostDetails post={post.data} advancedMode={advancedView} />
      </div>
    </>
  )
}
