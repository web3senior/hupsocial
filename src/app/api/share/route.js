// app/api/share/route.js

import { NextResponse } from 'next/server'

/**
 * Fallback receiver for the Web Share Target declared in app/manifest.js.
 *
 * public/sw.js normally intercepts this POST and keeps the shared files in Cache Storage,
 * so the request only reaches the server when no worker is controlling the client yet —
 * the first launch after install, or a browser with service workers disabled. Files cannot
 * survive the redirect below, so this path preserves the text half of the share and tells
 * /share to explain what was dropped.
 */
export async function POST(request) {
  const params = new URLSearchParams()

  try {
    const formData = await request.formData()

    for (const field of ['title', 'text', 'url']) {
      const value = formData.get(field)
      if (typeof value === 'string' && value.trim()) params.set(field, value.trim())
    }

    const hasFiles = formData.getAll('media').some((entry) => typeof entry === 'object' && entry && entry.size > 0)
    if (hasFiles) params.set('media', 'dropped')
  } catch (error) {
    console.error('Failed to parse the shared payload:', error)
    params.set('error', '1')
  }

  const query = params.toString()

  // 303 so the browser follows with a GET — a POST navigation would hit the page route
  return NextResponse.redirect(new URL(query ? `/share?${query}` : '/share', request.url), 303)
}
