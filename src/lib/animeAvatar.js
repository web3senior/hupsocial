/** Adult, fully clothed anime-inspired portraits composed from validated avatar traits. */
const HAIR = {
  // [base, line, shine]
  blonde: ['#f7d23e', '#b07d12', '#fff4a8'],
  brown: ['#8a5634', '#4a2a1c', '#c99468'],
  black: ['#3a3a52', '#16161f', '#7a7896'],
  silver: ['#dfe4ee', '#7c859e', '#ffffff'],
  pink: ['#f290bb', '#a8406f', '#ffd6e7'],
}

const SKIN = {
  // [base, shade, line]
  light: ['#ffe8dc', '#f5c4b3', '#c98a7c'],
  tan: ['#e0a983', '#c48562', '#93583f'],
  deep: ['#9a6049', '#7d4a37', '#4f2c22'],
}

const LASH = '#2a1f2b'
const EYE_Y = 214

/* One eye drawn around the origin, facing right; the right eye is the same drawing mirrored. */
const portraitEye = (side, expression, [iris, irisDark]) => {
  const flip = side === 'r' ? -1 : 1
  const x = side === 'r' ? 306 : 206
  let markup
  if (expression === 'happy') {
    markup = `<path d="M-26 8q26-30 52 0" fill="none" stroke="${LASH}" stroke-width="6" stroke-linecap="round"/>`
  } else if (expression === 'sleepy') {
    markup = `<path d="M-28 2q28 20 54 0" fill="none" stroke="${LASH}" stroke-width="6" stroke-linecap="round"/><path d="m-24 8-6 7m12-3-3 8" stroke="${LASH}" stroke-width="3" stroke-linecap="round"/>`
  } else {
    markup = [
      `<clipPath id="portrait-eye-${side}"><path d="M-28 0q22-26 56-14l-2 26q-24 24-52 4Z"/></clipPath>`,
      '<path d="M-28 0q22-26 56-14l-2 26q-24 24-52 4Z" fill="#fff"/>',
      `<g clip-path="url(#portrait-eye-${side})">`,
      `<ellipse cx="2" cy="4" rx="17" ry="22" fill="url(#portrait-iris)"/>`,
      `<ellipse cx="2" cy="4" rx="17" ry="22" fill="none" stroke="${irisDark}" stroke-width="2.5"/>`,
      `<ellipse cx="2" cy="3" rx="7" ry="11" fill="${LASH}"/>`,
      `<path d="M-28-4h60v10q-30-10-60 0Z" fill="${irisDark}" opacity=".35"/>`,
      '</g>',
      `<circle cx="-5" cy="-6" r="5.5" fill="#fff"/><circle cx="9" cy="14" r="2.5" fill="#fff" opacity=".85"/>`,
      // Heavy upper lash line with a flick at the outer corner, and a thin lower lid
      `<path d="M-31 2q22-30 61-16l5-4" fill="none" stroke="${LASH}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`,
      `<path d="M-20 20q20 8 42-6" fill="none" stroke="${LASH}" stroke-width="2" stroke-linecap="round" opacity=".7"/>`,
    ].join('')
  }
  const brow = `<path d="M-26-36q18-10 44-6" fill="none" stroke="${irisDark}" stroke-width="3.5" stroke-linecap="round"/>`
  return `<g transform="translate(${x} ${EYE_Y}) scale(${flip} 1)">${brow}${markup}</g>`
}

/* Hair locks: alternating tip and root points joined by curves that bow `bend` px sideways. */
const locks = (points, bend = 10) =>
  points
    .slice(1)
    .map(([x, y], i) => {
      const [px, py] = points[i]
      return `Q${(px + x) / 2 + bend} ${(py + y) / 2} ${x} ${y}`
    })
    .join('')

export const animeAvatarSvg = (traits, palette, emblem, { background = true, sleeping = false } = {}) => {
  const [hair, hairLine, shine] = HAIR[traits.hairColor] || HAIR.blonde
  const [skin, skinShade, skinLine] = SKIN[traits.skin] || SKIN.light
  const expression = sleeping ? 'sleepy' : traits.eyes
  const style = traits.hair
  const hairStroke = `stroke="${hairLine}" stroke-width="3" stroke-linejoin="round"`

  // How far the side locks in front of the face fall: past the shoulders, to the jaw, or between
  const lockEnd = style === 'long' ? 420 : style === 'bob' ? 300 : 352

  const backHair = {
    long: `<path d="M138 170C112 280 118 380 86 486${locks([[86, 486], [126, 452], [150, 498], [176, 440], [336, 440], [362, 498], [386, 452], [426, 486]], 0)}C394 380 400 280 374 170Z" fill="url(#portrait-hair)" ${hairStroke}/>`,
    bob: `<path d="M140 170C124 240 128 290 136 318Q166 300 186 312L326 312Q346 300 376 318C384 290 388 240 372 170Z" fill="url(#portrait-hair)" ${hairStroke}/>`,
    ponytail: [
      `<path d="M142 170C126 240 132 300 142 336Q170 318 190 326L322 326Q342 318 370 336C380 300 386 240 370 170Z" fill="url(#portrait-hair)" ${hairStroke}/>`,
      // A high ponytail rising from the crown and cascading down the left side
      `<path d="M214 66C178 6 106 14 86 82C66 150 100 204 76 270C64 306 48 334 36 368${locks([[36, 368], [80, 346], [74, 412], [118, 362], [132, 428], [150, 344]], 6)}C150 270 168 160 214 108Z" fill="url(#portrait-hair)" ${hairStroke}/>`,
      `<path d="M190 52C130 36 104 80 100 130M118 150c-4 60 -20 120 -44 180M140 170c0 60-8 120-20 170" fill="none" stroke="${hairLine}" stroke-width="2.5" stroke-linecap="round" opacity=".55"/>`,
      `<path d="M150 46q-40 10-46 60" fill="none" stroke="${shine}" stroke-width="7" stroke-linecap="round" opacity=".7"/>`,
    ].join(''),
  }[style] || ''

  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">',
    '<defs>',
    `<linearGradient id="portrait-bg" x2="0" y2="1"><stop stop-color="${palette.vividTop}"/><stop offset="1" stop-color="${palette.vivid}"/></linearGradient>`,
    `<linearGradient id="portrait-hair" gradientUnits="userSpaceOnUse" y1="30" x2="0" y2="512"><stop stop-color="${shine}"/><stop offset=".25" stop-color="${hair}"/><stop offset=".75" stop-color="${hair}"/><stop offset="1" stop-color="${hairLine}"/></linearGradient>`,
    `<linearGradient id="portrait-iris" x2="0" y2="1"><stop stop-color="${hairLine}"/><stop offset=".55" stop-color="${hair}"/><stop offset="1" stop-color="${shine}"/></linearGradient>`,
    `<linearGradient id="portrait-shirt" x2="0" y2="1"><stop stop-color="#fff"/><stop offset="1" stop-color="${palette.shellBottom}"/></linearGradient>`,
    '</defs>',
    background ? '<path fill="url(#portrait-bg)" d="M0 0h512v512H0z"/>' : '',
    // The head tilts a touch; the body stays square to the frame
    // Back hair plus a crown cap, so nothing behind the bangs shows the background
    `<g transform="rotate(-4 256 300)">${backHair}<path d="M144 232C116 120 170 34 256 34C346 34 400 120 368 232Z" fill="url(#portrait-hair)" ${hairStroke}/></g>`,
    // Relaxed shoulders and a fitted sweetheart top with a balanced, fuller silhouette.
    `<path d="M188 347c-43 2-63 20-72 53L88 512h47l29-108 24-17Zm136 0c43 2 63 20 72 53l28 112h-47l-29-108-24-17Z" fill="${skin}" stroke="${skinLine}" stroke-width="3"/>`,
    `<path d="M228 270v58l-50 23 10 111h136l10-111-50-23v-58Z" fill="${skin}" stroke="${skinLine}" stroke-width="3"/>`,
    `<path d="M228 292q28 26 56 0v22q-28 24-56 0Z" fill="${skinShade}"/>`,
    `<path d="m188 347 10-5-2 37c25-18 45 34 60 65 15-31 35-83 60-65l-2-37 10 5 17 37c28 8 47 32 43 58-3 22-20 36-40 42l8 28H160l8-28c-20-6-37-20-40-42-4-26 15-50 43-58Z" fill="url(#portrait-shirt)" stroke="${palette.line}" stroke-width="3" stroke-linejoin="round"/>`,
    `<path d="M196 379c25-18 45 34 60 65 15-31 35-83 60-65" fill="none" stroke="${palette.line}" stroke-width="3" stroke-linecap="round"/>`,
    `<path d="M146 448q39 31 94 0m32 0q55 31 94 0m-187 43q77 16 154 0" fill="none" stroke="${palette.stroke}" stroke-width="3" stroke-linecap="round"/>`,
    // The shared chest mark or network badge, printed on the shirt
    `<g transform="translate(95 198) scale(.63)">${emblem}</g>`,
    '<g transform="rotate(-4 256 300)">',
    // An oval face narrowing to a soft pointed chin; the side locks hide the ears
    // The forehead runs up under the bangs so skin, not background, shows between the locks
    `<path d="M158 150C156 228 186 282 256 316C326 282 356 228 354 150C354 96 158 96 158 150Z" fill="${skin}" stroke="${skinLine}" stroke-width="3"/>`,
    portraitEye('l', expression, [hair, hairLine]),
    traits.eyes === 'wink' && !sleeping ? portraitEye('r', 'happy', [hair, hairLine]) : portraitEye('r', expression, [hair, hairLine]),
    `<path d="m258 250-3 9h6" fill="none" stroke="${skinLine}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`,
    {
      o: `<path d="M245 283q11-5 22 0q-11 9-22 0Z" fill="#b85d6a" stroke="${skinLine}" stroke-width="2"/><path d="M248 283h16" stroke="#fff" stroke-width="2" stroke-linecap="round"/>`,
      smile: `<path d="M242 280q14 12 28 0" fill="none" stroke="${skinLine}" stroke-width="3" stroke-linecap="round"/>`,
      none: `<path d="M250 283h12" fill="none" stroke="${skinLine}" stroke-width="2.5" stroke-linecap="round"/>`,
    }[traits.mouth] || '',
    traits.cheeks === 'blush'
      ? '<g fill="#ff7f99" opacity=".35"><ellipse cx="190" cy="252" rx="22" ry="10"/><ellipse cx="322" cy="252" rx="22" ry="10"/></g><path d="m180 256 5-8m4 8 5-8m4 8 5-8m116 8 5-8m4 8 5-8m4 8 5-8" stroke="#e0607c" stroke-width="2" stroke-linecap="round" opacity=".6"/>'
      : '',
    // Crown and shaggy bangs, parted slightly off-centre, with a lock falling between the eyes
    `<path d="M144 232C116 120 170 34 256 34C346 34 400 120 368 232${locks([[368, 232], [352, 150], [344, 206], [318, 128], [300, 198], [284, 122], [262, 244], [246, 122], [224, 198], [206, 126], [186, 210], [170, 146], [144, 232]], -10)}Z" fill="url(#portrait-hair)" ${hairStroke}/>`,
    `<path d="M188 130q14-50 54-70m30 2q44 10 66 60M256 118l6-56" fill="none" stroke="${hairLine}" stroke-width="2.5" stroke-linecap="round" opacity=".5"/>`,
    `<path d="M176 104q36-34 80-34m30 4q34 8 52 30" fill="none" stroke="${shine}" stroke-width="8" stroke-linecap="round" opacity=".75"/>`,
    // Side locks framing the face
    `<path d="M154 120C134 190 142 270 ${style === 'long' ? 128 : 146} ${lockEnd}${locks([[style === 'long' ? 128 : 146, lockEnd], [168, lockEnd - 40], [178, lockEnd - 14], [174, 250]], 4)}C168 200 166 150 154 120Z" fill="url(#portrait-hair)" ${hairStroke}/>`,
    `<path d="M358 120C378 190 370 270 ${style === 'long' ? 384 : 366} ${lockEnd}${locks([[style === 'long' ? 384 : 366, lockEnd], [344, lockEnd - 40], [334, lockEnd - 14], [338, 250]], -4)}C344 200 346 150 358 120Z" fill="url(#portrait-hair)" ${hairStroke}/>`,
    style === 'ponytail' ? `<path d="m196 74 22-14" stroke="${palette.line}" stroke-width="14" stroke-linecap="round"/>` : '',
    '</g>',
    '</svg>',
  ].join('')
}
