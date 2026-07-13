'use client'

import { useRef, useState } from 'react'
import { uploadFileToIPFS } from '@/lib/ipfs'
import { resolveStorageImageUrl } from '@/lib/storageHelper'
import styles from '../page.module.scss'

// Device-file picker for community images — uploads to IPFS exactly like NewPost's media flow
// and stores the resulting ipfs:// URL in the same metadata fields the old URL inputs filled,
// so existing communities with pasted https URLs keep working unchanged.
export default function ImagePicker({ label, value, onChange, fieldClassName, labelClassName }) {
  const inputRef = useRef(null)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')

  const handleSelect = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setUploadError('Please choose an image file.')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setUploadError('Image must be under 10 MB.')
      return
    }

    setUploadError('')
    setIsUploading(true)
    try {
      onChange(await uploadFileToIPFS(file))
    } catch (err) {
      console.error('Community image upload failed:', err)
      setUploadError('Upload failed. Please try again.')
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <div className={fieldClassName || styles.card__field}>
      <label className={labelClassName || styles.card__label}>{label}</label>
      <input ref={inputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleSelect} />
      {value && (
        <img
          src={resolveStorageImageUrl(value, { width: 400 }) || value}
          alt=""
          style={{ maxHeight: 120, maxWidth: '100%', borderRadius: 8, objectFit: 'cover', alignSelf: 'flex-start' }}
        />
      )}
      <div className="flex gap-050">
        <button
          type="button"
          className={styles.card__editBtn}
          disabled={isUploading}
          onClick={() => inputRef.current?.click()}
        >
          {isUploading ? 'Uploading...' : value ? 'Replace image' : 'Choose from device'}
        </button>
        {value && !isUploading && (
          <button type="button" className={styles.card__cancelBtn} onClick={() => onChange('')}>
            Remove
          </button>
        )}
      </div>
      {uploadError && <small style={{ color: 'var(--liked-color)' }}>{uploadError}</small>}
    </div>
  )
}
