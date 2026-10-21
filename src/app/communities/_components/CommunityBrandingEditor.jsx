'use client'

import { resolveStorageImageUrl } from '@/lib/storageHelper'
import BannerEditor from '@/components/ui/BannerEditor'
import useImageUpload from './useImageUpload'

/**
 * Community branding editor
 * The shared BannerEditor wired for a community: images upload to IPFS as soon as they are picked,
 * and the preview carries the community's name and summary. Shared by the create and edit modals.
 * @param {Object} props
 * @param {string} props.name
 * @param {string} props.summary
 * @param {string} props.logoUrl
 * @param {Function} props.onLogoChange
 * @param {string} props.coverUrl
 * @param {Function} props.onCoverChange
 * @param {number} props.coverPosition
 * @param {Function} props.onCoverPositionChange
 * @param {string} [props.fieldClassName]
 * @param {string} [props.labelClassName]
 */
export default function CommunityBrandingEditor({
  name,
  summary,
  logoUrl,
  onLogoChange,
  coverUrl,
  onCoverChange,
  coverPosition,
  onCoverPositionChange,
  fieldClassName,
  labelClassName,
}) {
  const cover = useImageUpload(onCoverChange)
  const logo = useImageUpload(onLogoChange)
  const display = (url, width) => (url ? resolveStorageImageUrl(url, { width }) || url : null)

  return (
    <BannerEditor
      label="Look & feel"
      title={name}
      subtitle={summary}
      titlePlaceholder="Community name"
      subtitlePlaceholder="Your short summary shows here"
      coverSrc={display(coverUrl, 1200)}
      avatarSrc={display(logoUrl, 400)}
      coverPosition={coverPosition}
      onCoverPositionChange={onCoverPositionChange}
      onCoverPick={cover.upload}
      onAvatarPick={logo.upload}
      onCoverRemove={() => onCoverChange('')}
      onAvatarRemove={() => onLogoChange('')}
      coverBusy={cover.isUploading}
      avatarBusy={logo.isUploading}
      labels={{ addAvatar: 'Add logo', changeAvatar: 'Change logo', removeAvatar: 'Remove logo' }}
      error={cover.uploadError || logo.uploadError}
      fieldClassName={fieldClassName}
      labelClassName={labelClassName}
    />
  )
}
