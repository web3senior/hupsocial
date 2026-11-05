/** Flat UP! mark; the lettering is cut out so it follows the emblem's face colour. */
export default function UniversalProfileIcon({ weight, ...props }) {
  return (
    <svg viewBox="0 0 64 64" fill="currentColor" {...props}>
      <path fillRule="evenodd" clipRule="evenodd" d="M12 2h40a10 10 0 0 1 10 10v40a10 10 0 0 1-10 10H12A10 10 0 0 1 2 52V12A10 10 0 0 1 12 2ZM8 21v15c0 7 4 11 11 11s11-4 11-11V21h-7v15c0 3-1 5-4 5s-4-2-4-5V21H8Zm26 0v26h6v-8h3c6 0 9-3 9-9s-3-9-9-9h-9Zm6 6h3c2 0 3 1 3 3s-1 3-3 3h-3v-6Zm14-6 1 17h3l1-17h-5Zm2.5 20a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z" />
    </svg>
  )
}
