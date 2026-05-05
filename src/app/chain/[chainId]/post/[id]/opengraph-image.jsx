import { ImageResponse } from 'next/og'
import { getPostByIndex } from '@/lib/communication'
 
// Image metadata
export const size = {
  width: 1200,
  height: 630,
}
 
export const contentType = 'image/png'
 
// Image generation
export default async function Image({ params }) {
  const post = await getPostByIndex(params.id)

if (!post) {
  return new ImageResponse(
    // Default error image JSX
    <div style={{color:`red`}}>Post Not Found</div>
  );
}


  post.postId = params.id

  return new ImageResponse(
    (
      // ImageResponse JSX element
      <div
        style={{
          fontSize: 128,
          background: 'white',
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {post.postId}
      </div>
    )
  )
}