"use client";

import styles from './ShortsFeed.module.scss';

export default function ShortsFeed({ posts = [] }) {
  // Filter for video posts only

  const videoPosts = posts.filter(post => post.mediaType === 'video');

  return (
    <div className={styles.scrollContainer}>
      {videoPosts.map((post) => (
        <div key={post.id} className={styles.videoSlide}>
          <video
            src={post.videoUrl}
            loop
            muted
            playsInline
            className={styles.videoPlayer}
          />
          <div className={styles.overlay}>
            <span>@{post.author}</span>
            <p>{post.caption}</p>
          </div>
        </div>
      ))}
    </div>
  );
}