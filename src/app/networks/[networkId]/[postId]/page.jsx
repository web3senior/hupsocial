import { getPostById } from '@/lib/api'
import PageTitle from '@/components/PageTitle'
import PostDetails from './_components/PostDetails'
import { notFound } from 'next/navigation'
import styles from './page.module.scss'
import { resolveIPFSUrl } from '@/lib/storageHelper'

export async function generateMetadata({ params }, parent) {
  const parentMetadata = await parent
  // console.log('Generating metadata for post with params:', parentMetadata)

  // optionally access and extend (rather than replace) parent metadata
  const previousImages = (await parent).openGraph?.images || []

  const { networkId, postId } = await params

  try {
    const post = await getPostById(networkId, postId, null)
    const item = post?.data

    let images = []

    if (item?.content?.elements?.[1]?.type === 'media' && item?.content?.elements?.[1]?.data?.items.length > 0) {
      item.content.elements[1].data.items.forEach((mediaItem) => {
        console.log(`Processing media item for metadata:`, mediaItem)
        if (mediaItem.type === 'image') {
          images.push({
            url: mediaItem.cid.startsWith('http') ? mediaItem.cid : `${resolveIPFSUrl(mediaItem.cid)}`,
            width: mediaItem.width || 1200, // Default width if not provided
            height: mediaItem.height || 630, // Default height if not provided
            alt: mediaItem.alt || 'Post Image',
          })
        }
      })
    }

    images.push(...previousImages)

    const bodyText = post?.data?.content?.elements?.[0]?.data?.text || ''

    const metadata = {
      // Slice the first 60 characters for the SEO title
      title: bodyText.slice(0, 60).trim() || 'Post Details',

      // Slice the first 160 characters for the description, then fall back if empty
      description: bodyText.slice(0, 160).trim() || parentMetadata.description || 'View the details of this post on our platform.',

      openGraph: {
        images: images.length > 0 ? images : parentMetadata.openGraph?.images || [],
      },
    }

    return metadata
  } catch (error) {
    // Return fallback metadata if the initial fetch fails
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
      <div className={`${styles.page} ms-motion-slideDownIn`}>
        <PostDetails post={post.data} advancedMode={advancedView} />
      </div>
    </>
  )
}
