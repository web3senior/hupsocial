import { getPostById } from '@/lib/api'
import PageTitle from '@/components/PageTitle'
import PostDetails from './_components/PostDetails'
import { notFound } from 'next/navigation'
import styles from './page.module.scss'

// Generate dynamic metadata for SEO optimization
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
        if (mediaItem.type === 'image') {
          images.push({
            url: mediaItem.data.cid.startsWith('http') ? mediaItem.data.cid : `${process.env.NEXT_PUBLIC_GATEWAY_URL}${mediaItem.data.cid}`,
            width: mediaItem.data.width || 1200, // Default width if not provided
            height: mediaItem.data.height || 630, // Default height if not provided
            alt: mediaItem.data.alt || 'Post Image',
          })
        }
      })
    }

    images.push(...previousImages)

    const metadata = {
      title: post?.data?.content?.elements?.[0]?.data?.text.slice(0, 60) || 'Post Details',
      description:
        post?.data?.content?.elements?.[0]?.data?.text.slice(0, 160) ||
        parentMetadata.description ||
        'View the details of this post on our platform.',
      openGraph: {
        images: images.length > 0 ? images : parentMetadata.openGraph?.images || [],
      },
    }
    // console.log('Generated metadata for post:', metadata)
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
