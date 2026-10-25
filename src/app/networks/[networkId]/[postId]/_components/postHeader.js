const viewsFormatter = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })

/**
 * Header props for the post page, shared by page.jsx and loading.jsx so the header does not
 * change when the route boundary swaps. The header's back arrow returns to the page the reader
 * came from; the target here is where it goes when there is none, since a shared post URL is
 * usually the first page of the visit and history.back() from there would leave the site. That
 * is wherever the post lives: its community or the home feed.
 * subtitle is null while the count is unknown (no row yet, or a cached row without one), so the
 * row can hold its place with a shimmer; '' means a known zero.
 */
export function postHeaderProps(post, networkId) {
  const communityId = post?.community_id
  const views = post?.total_views == null ? null : Number(post.total_views) || 0

  return {
    backHref: communityId ? `/communities/${post.network_id ?? networkId}/${communityId}` : '/',
    backLabel: communityId ? 'Back to community' : 'Back to feed',
    subtitle: views === null ? null : views > 0 ? `${viewsFormatter.format(views)} ${views === 1 ? 'view' : 'views'}` : '',
  }
}
