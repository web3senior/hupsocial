import React, { useEffect, useState } from 'react';
import FsLightbox from 'fslightbox-react';

// REMOVED: lightgallery/react, lightgallery/plugins/*, and all CSS imports

import styles from './Gallery.module.scss';

/**
 * ImageGallery Component
 * Renders a grid of images using FsLightbox for a lightbox experience.
 * Filters the input data to only show items where item.type is NOT 'video'.
 * @param {Array<Object>} data - The array of media items.
 */
export function ImageGallery({ data }) {
  const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL;

  // State for FsLightbox
  const [toggler, setToggler] = useState(false);
  const [sourceIndex, setSourceIndex] = useState(0);

  // Original useEffect is preserved
  useEffect(() => {
    console.log('Received data for Image Gallery:', data);
  }, [data]);

  // Filter data to only include images (maintaining original filter logic)
  const images = data ? data.filter((item) => item.type !== 'video') : [];

  // Create the sources array for FsLightbox
  const sources = images.map((item) => `${GATEWAY_URL}${item.cid}`);
  
  // Create descriptions array for captions (replaces lightGallery's data-sub-html)
  const descriptions = images.map((item, i) => item.alt || `Image ${i + 1}`);

  return (
    <div className={`${styles.page}`}>
      {images.length > 0 ? (
        <>
          {/* Replaced LightGallery wrapper with a standard div */}
          <div className={styles.imageGrid}> 
            {images.map((item, i) => (
              <div
                key={i}
                // Replaced <a> tag with div/button to trigger the lightbox
                className="gallery-item image"
                onClick={(e) => {
                  e.stopPropagation();
                  setSourceIndex(i);      // Set the index of the clicked item
                  setToggler(!toggler);   // Open the lightbox
                }}
                style={{ cursor: 'pointer' }} // Added style for visual cue
              >
                <img 
                  alt={item?.alt || `Gallery image ${i + 1}`} 
                  src={`${GATEWAY_URL}${item.cid}`} 
                  className="img-responsive" 
                />
              </div>
            ))}
          </div>

          {/* FsLightbox Component */}
          <FsLightbox
            toggler={toggler}
            sources={sources}
            sourceIndex={sourceIndex} // Tells FsLightbox which slide to start on
            descriptions={descriptions} // Used for captions/sub-html
          />
        </>
      ) : (
        <></>
      )}
    </div>
  );
}

/**
 * VideoList Component
 * Renders a simple list of videos with their thumbnails and titles.
 * (No changes needed, as it did not use lightGallery)
 * @param {Array<Object>} data - The array of media items.
 */
export function VideoList({ data }) {
  const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL;

  useEffect(() => {
    console.log('Received data for Video List:', data);
  }, [data]);

  // Filter data to only include videos
  const videos = data ? data.filter((item) => item.type === 'video') : [];

  return (
    <div className={`${styles.page}`}>
      {videos.length > 0 ? (
        <div className={styles.videoGrid}>
          {videos.map((item, i) => (
            <div key={i} className={styles.videoItem} onClick={(e) => e.stopPropagation()}>
              <video src={`${process.env.NEXT_PUBLIC_GATEWAY_URL}${item.cid}`} controls />
            </div>
          ))}
        </div>
      ) : (
        <></>
      )}
    </div>
  );
}