import { getPostById } from '@/lib/api'
import PageTitle from '@/components/PageTitle'
import PostDetails from './_components/PostDetails'
import { notFound } from 'next/navigation'
import styles from './page.module.scss'
import { resolveIPFSUrl } from '@/lib/storageHelper'

export async function generateMetadata({ params }, parent) {
  // Fetch and resolve the parent metadata object
  const parentMetadata = await parent

  // Extract previously resolved images from parent Open Graph properties
  const previousImages = parentMetadata.openGraph?.images || []

  // Extract required parameters for fetching the dynamic post
  const { networkId, postId } = await params

  try {
    // Attempt to fetch post data from the external source
    const post = await getPostById(networkId, postId, null)
    const item = post?.data

    // Initialize an array to hold mapped images for metadata tags
    let images = []

    // Check if the post structure contains elements, media layout, and items
    if (item?.content?.elements?.[1]?.type === 'media' && item?.content?.elements?.[1]?.data?.items.length > 0) {
      item.content.elements[1].data.items.forEach((mediaItem) => {
        // Log individual items to aid with diagnostic tracing
        console.log(`Processing media item for metadata:`, mediaItem)
        if (mediaItem.type === 'image') {
          // Normalize and push structural image configuration object
          images.push({
            url: mediaItem.cid.startsWith('http') ? mediaItem.cid : `${resolveIPFSUrl(mediaItem.cid)}`,
            width: mediaItem.width || 1200,
            height: mediaItem.height || 630,
            alt: mediaItem.alt || 'Post Image',
          })
        }
      })
    }

    // Append inherited parent images to maintain complete metadata chains
    images.push(...previousImages)

    // Fall back to empty text string if body content cannot be resolved
    const bodyText = post?.data?.content?.elements?.[0]?.data?.text || ''

    // Construct unified dynamic metadata configuration payload
    const metadata = {
      // Slice the first 60 characters for the SEO title
      title: bodyText.slice(0, 60).trim() || 'Post Details',

      // Slice the first 160 characters for the description, then fall back if empty
      description: bodyText.slice(0, 160).trim() || parentMetadata.description || 'View the details of this post on our platform.',

      // Build out Open Graph specific data representations
      openGraph: {
        images: images.length > 0 ? images : parentMetadata.openGraph?.images || [],
      },

      // Construct corresponding Twitter metadata mappings
      twitter: {
        // Direct the Twitter crawler to map extracted dynamic image variants
        images: images.length > 0 ? images : parentMetadata.twitter?.images || [],
      },
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
