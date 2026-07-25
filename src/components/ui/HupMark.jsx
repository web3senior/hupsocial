/**
 * Hup Mark
 * The Hup logo as an inline SVG rather than an <img src="/logo.svg">, so the mark paints
 * in currentColor and follows whatever muted/theme colour its container sets — an <img>
 * renders the file's own fill and ignores the theme entirely.
 *
 * Used as the placeholder wherever NFT artwork hasn't resolved (market tiles, TradeCard,
 * listing detail). Decorative by default; pass a `title` where it needs a name.
 * @param {Object} props
 * @param {number} [props.size=24] Rendered edge length in px.
 * @param {string} [props.className]
 * @param {string} [props.title] Accessible name — omit to keep the mark decorative.
 */
export default function HupMark({ size = 24, className, title }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 51 51"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : 'true'}
      focusable="false"
    >
      {title && <title>{title}</title>}
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M19.2024 1L10 4.98374V46.003L19.2024 50L28.6439 46.003V39.3634L34.6859 42.0856L40.9271 39.3634V11.6499L34.6859 9.03388L28.6439 11.6499V4.98374L19.2024 1ZM19.468 45.4054V5.66098L24.5539 7.82547V23.3886H34.6859V12.0615L38.258 13.6683V37.4512L34.6859 38.965V27.3192H24.5539V43.2409L19.468 45.4054Z"
        fill="currentColor"
      />
    </svg>
  )
}
