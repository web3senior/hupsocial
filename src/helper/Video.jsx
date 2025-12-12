import React from 'react'

const style = {
  width: '100%',
  height: 'auto',
  objectFit: 'fill'
}

export const Video = (props) => {
  const videoRef = React.useRef(null);
  const { options } = props;

  React.useEffect(() => {
    const video = videoRef.current
    video.poster = options.poster
    video.autoplay = options.autoplay
    video.controls = options.controls
    video.src = options.sources[0].src
  }, [options, videoRef]);

  return <video ref={videoRef} style={style} />
}

export default Video;