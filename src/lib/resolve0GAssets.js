// helpers/resolve0GAssets.js

export async function resolve0GAssets(data, resolvedUrls = {}) {
  const nextResolvedUrls = {}
  const createdObjectUrls = []

  for (const item of data ?? []) {
    const cid = item?.cid

    if (item?.storage !== '0G' || !cid || resolvedUrls[cid] || nextResolvedUrls[cid]) {
      continue
    }

    try {
      const res = await fetch(`/api/0g/download?hash=${encodeURIComponent(cid)}`)

      if (!res.ok) {
        throw new Error('Download failed')
      }

      const blob = await res.blob()
      const objectUrl = URL.createObjectURL(blob)

      nextResolvedUrls[cid] = objectUrl
      createdObjectUrls.push(objectUrl)
    } catch (err) {
      console.error('0G_RESOLVE_ERROR:', err)
    }
  }

  return {
    nextResolvedUrls,
    createdObjectUrls,
  }
}

export function revokeObjectUrls(urls = []) {
  urls.forEach((url) => URL.revokeObjectURL(url))
}