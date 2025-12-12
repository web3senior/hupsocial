import { useEffect, useRef, useState } from 'react'
import LoadingSpinner from './../components/LoadingSpinner'

export default function Iframe(props) {
  const [isLoading, setIsLoading] = useState(true)
  const iframeRef = useRef()

  useEffect(() => {
    iframeRef.current.addEventListener('load', () => {
      setIsLoading(false)
    })
  }, [])

  return (
    <>
      {isLoading ? <LoadingSpinner /> : <></>}
      <iframe
        ref={iframeRef}
        src={props.url}
        width={props.properties.width}
        height={props.properties.height}
        style={props.properties.style}
        loading={props.properties.loading}
        allowFullScreen
        aria-hidden="false"
        tabIndex="0"
        title={props.properties.title}
      />
    </>
  )
}

Iframe.defaultProps = {
  url: '',
  zoom: 11,
  properties: {
    width: '100%',
    height: '100%',
    style: {
      border: 0,
    },
    loading: 'lazy',
  },
}
