/**
 * @component MerchantLogo
 * @description Resolves a 0G Storage rootHash into a viewable image.
 */
import { Loader2 } from 'lucide-react'
import { Store } from 'lucide-react'
import { useEffect, useState, useMemo } from 'react'

const ImageToBlob = ({ rootHash, className = '' }) => {
  const [previewUrl, setPreviewUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    let activeUrl = ''

    const resolveHash = async () => {
      if (!rootHash) {
        setPreviewUrl('')
        return
      }

      // Handle standard URLs or already resolved blobs
      // if (rootHash.startsWith('http') || rootHash.startsWith('blob:')) {
      //   setPreviewUrl(rootHash)
      //   return
      // }

      setLoading(true)
      setError(false)

      try {
        // We fetch from our internal API which uses the 0G SDK
        const res = await fetch(`/api/v1/0g/download?hash=${rootHash}`)

        if (!res.ok) throw new Error('Download failed')

        const blob = await res.blob()
        activeUrl = URL.createObjectURL(blob)
        setPreviewUrl(activeUrl)
      } catch (err) {
        console.error('MERCHANT_LOGO_ERROR:', err)
        setError(true)
      } finally {
        setLoading(false)
      }
    }

    resolveHash()

    return () => {
      if (activeUrl) URL.revokeObjectURL(activeUrl)
    }
  }, [rootHash])

  if (loading) {
    return (
      <div className={`flex items-center justify-center bg-gray-100 ${className}`}>
        <Loader2 className="animate-spin text-gray-400" size={20} />
      </div>
    )
  }

  if (error || !previewUrl) {
    return (
      <div className={`flex items-center justify-center bg-gray-100 text-gray-400 ${className}`}>
        <Store size={24} />
      </div>
    )
  }

  return (
    <img
      src={previewUrl}
      alt="Merchant Logo"
      className={`object-cover ${className}`}
      onError={() => setError(true)}
    />
  )
}

export default MerchantLogo
