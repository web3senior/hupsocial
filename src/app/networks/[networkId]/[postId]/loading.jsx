'use client'

import clsx from 'clsx'
import { useParams } from 'next/navigation'
import PageTitle from '@/components/PageTitle'
import Post from '@/components/Post'
import { usePostStore } from '@/stores/usePostStore'
import pageStyles from './page.module.scss'
import detailStyles from './_components/PostDetails.module.scss'

// Every navigation into this dynamic route pays a server roundtrip, and this
// boundary is what the user sees during it. The click handlers put the tapped
// post in the store before router.push, so paint the real post here — the
// markup mirrors PostDetails exactly, making the Suspense swap invisible.
export default function Loading() {
  const params = useParams()
  const currentPost = usePostStore((state) => state.currentPost)

  // Only trust the cache when it is the post being navigated to (back/forward
  // can land here with a stale currentPost from another thread)
  const targetId = params?.postId
  const cachedMatchesTarget = currentPost && (targetId == null || String(currentPost.id) === String(targetId))

  return (
    <>
      <PageTitle name={`Post`} changeDocumentTitle={false} />
      <div className={pageStyles.page}>
        {cachedMatchesTarget ? (
          <div className={detailStyles.post}>
            <div className={clsx('__container', detailStyles.page__container)} data-width={`small`}>
              <div className={clsx(detailStyles.grid, 'flex flex-column')}>
                {/* No entry animation: PostDetails renders this same article without one
                    after the Suspense swap, and a restarted `animate fade` (backwards
                    fill + delay) blanks the already-visible post — a visible flash. */}
                <article className={detailStyles.post}>
                  <Post
                    item={currentPost}
                    showContent={true}
                    chainId={currentPost.network_id || params?.networkId}
                    actions={['like', 'comment', 'repost', 'tip', 'view', 'share', 'bookmark']}
                  />
                  <hr />
                </article>
              </div>
              <div>Loading discussion thread...</div>
            </div>
          </div>
        ) : (
          <Skeleton />
        )}
      </div>
    </>
  )
}

// Fallback for entries without a cached post (direct URL, refresh, expired cache)
function Skeleton() {
  return (
    <div className={`__container`} data-width={`small`}>
      <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <section
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem',
            padding: '1rem',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div className="shimmer" style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0 }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', flex: 1 }}>
              <div className="shimmer" style={{ width: '35%', height: 12, borderRadius: 6 }} />
              <div className="shimmer" style={{ width: '20%', height: 10, borderRadius: 6 }} />
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', paddingLeft: '3rem' }}>
            <div className="shimmer" style={{ width: '90%', height: 12, borderRadius: 6 }} />
            <div className="shimmer" style={{ width: '80%', height: 12, borderRadius: 6 }} />
            <div className="shimmer" style={{ width: '60%', height: 12, borderRadius: 6 }} />
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', paddingLeft: '3rem', marginTop: '0.25rem' }}>
            {[48, 40, 40, 36].map((w, i) => (
              <div key={i} className="shimmer" style={{ width: w, height: 28, borderRadius: 999 }} />
            ))}
          </div>
        </section>

        {[1, 2, 3].map((i) => (
          <section
            key={i}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
              padding: '0.75rem 1rem',
              borderBottom: '1px solid var(--border)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div className="shimmer" style={{ width: 30, height: 30, borderRadius: '50%', flexShrink: 0 }} />
              <div className="shimmer" style={{ width: '28%', height: 10, borderRadius: 6 }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', paddingLeft: '2.6rem' }}>
              <div className="shimmer" style={{ width: `${70 + i * 7}%`, height: 11, borderRadius: 6 }} />
              {i < 3 && <div className="shimmer" style={{ width: `${50 + i * 5}%`, height: 11, borderRadius: 6 }} />}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
