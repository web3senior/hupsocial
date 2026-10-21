'use client'

import { useState } from 'react'
import { uploadFileToIPFS } from '@/lib/ipfs'

const MAX_IMAGE_BYTES = 10 * 1024 * 1024

// Community images upload the moment they are picked — exactly like NewPost's media flow — and
// hand back the ipfs:// URL that goes into the community's metadata.
export default function useImageUpload(onChange) {
  const [isUploading, setIsUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')

  const upload = async (file) => {
    if (!file.type.startsWith('image/')) {
      setUploadError('Please choose an image file.')
      return
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setUploadError('Image must be under 10 MB.')
      return
    }

    setUploadError('')
    setIsUploading(true)
    try {
      onChange(await uploadFileToIPFS(file))
    } catch (err) {
      console.error('Community image upload failed:', err)
      setUploadError(err.message || 'Upload failed. Please try again.')
    } finally {
      setIsUploading(false)
    }
  }

  return { upload, isUploading, uploadError }
}
