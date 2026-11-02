/**
 * @file lib/botAvatar.js
 * @description Hup's robot avatar: a flat, friendly bot drawn as SVG from a small set of traits —
 * a colour, a dome, ears, eyes, a mouth, a chest mark and cheeks. Pure and isomorphic.
 *
 * Any seed (an agent's address, a username) picks a full set of traits, so every agent has its own
 * robot with nothing stored; an owner can then override any trait. The SVG is built only from the
 * fixed fragments below and validated trait ids, never from free text, so it is safe to use as a
 * data URI or to rasterize into a profile picture.
 */

import { BOT_NETWORK_BADGES } from './botAvatarNetworks'
import { animeAvatarSvg } from './animeAvatar'

// --- Traits ---

/** Colours as a hue and a saturation scale, so every part of the robot is tinted consistently. */
export const BOT_COLORS = Object.freeze([
  { id: 'lavender', label: 'Lavender', hue: 262, sat: 1 },
  { id: 'sky', label: 'Sky', hue: 192, sat: 1 },
  { id: 'ocean', label: 'Ocean', hue: 222, sat: 1 },
  { id: 'rose', label: 'Rose', hue: 350, sat: 1 },
  { id: 'sunset', label: 'Sunset', hue: 34, sat: 1 },
  { id: 'mint', label: 'Mint', hue: 152, sat: 0.9 },
  { id: 'lime', label: 'Lime', hue: 88, sat: 0.85 },
  { id: 'magenta', label: 'Magenta', hue: 300, sat: 0.9 },
  { id: 'graphite', label: 'Graphite', hue: 230, sat: 0.15 },
])

export const BOT_TRAITS = Object.freeze({
  color: BOT_COLORS.map((color) => color.id),
  dome: ['brain', 'core', 'bolt', 'chip', 'antenna'],
  ears: ['pods', 'antennas', 'headset', 'none'],
  eyes: ['pill', 'round', 'happy', 'visor', 'sleepy', 'wink'],
  mouth: ['none', 'smile', 'grill', 'o'],
  // The marks first, then a badge per network (lib/botAvatarNetworks.js)
  chest: ['circuit', 'heart', 'bolt', 'dots', ...Object.keys(BOT_NETWORK_BADGES)],
  cheeks: ['none', 'blush'],
  style: ['robot', 'anime'],
  hair: ['ponytail', 'long', 'bob'],
  hairColor: ['blonde', 'brown', 'black', 'silver', 'pink'],
  skin: ['light', 'tan', 'deep'],
})

/** Labels for an editor; the ids above are what is stored. */
export const BOT_TRAIT_LABELS = Object.freeze({
  dome: { brain: 'Brain', core: 'Core', bolt: 'Bolt', chip: 'Chip', antenna: 'Antenna' },
  ears: { pods: 'Pods', antennas: 'Antennas', headset: 'Headset', none: 'None' },
  eyes: { pill: 'Pill', round: 'Round', happy: 'Happy', visor: 'Visor', sleepy: 'Sleepy', wink: 'Wink' },
  mouth: { none: 'None', smile: 'Smile', grill: 'Grill', o: 'Oh' },
  chest: { circuit: 'Circuit', heart: 'Heart', bolt: 'Bolt', dots: 'Dots', ...Object.fromEntries(Object.entries(BOT_NETWORK_BADGES).map(([id, badge]) => [id, badge.label])) },
  cheeks: { none: 'None', blush: 'Blush' },
  style: { robot: 'Robot', anime: 'Anime portrait' },
  hair: { ponytail: 'Ponytail', long: 'Long', bob: 'Bob' },
  hairColor: { blonde: 'Blonde', brown: 'Brown', black: 'Black', silver: 'Silver', pink: 'Pink' },
  skin: { light: 'Light', tan: 'Tan', deep: 'Deep' },
})

/* What a seed may pick, where narrower than everything on offer: network badges are a choice an
   owner makes, and adding one must never change the robot an existing address already has. */
const SEEDED_OPTIONS = { chest: ['circuit', 'heart', 'bolt', 'dots'], style: ['robot'] }
const OPTIONAL_TRAITS = ['style', 'hair', 'hairColor', 'skin']

/* FNV-1a, then a small xorshift per trait: stable across runtimes, and enough spread that agents
   whose addresses share a prefix still look different. */
const hashSeed = (seed) => {
  let hash = 0x811c9dc5
  for (const char of String(seed ?? '').toLowerCase()) {
    hash ^= char.codePointAt(0)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash
}

const nextRandom = (state) => {
  let x = state || 0x9e3779b9
  x ^= x << 13
  x ^= x >>> 17
  x ^= x << 5
  return x >>> 0
}

/**
 * The traits a seed picks.
 * @param {string} seed An agent's address, a username — anything stable.
 * @returns {Record<keyof BOT_TRAITS, string>}
 */
export const botTraitsFor = (seed) => {
  let state = hashSeed(seed)
  const traits = {}
  for (const [name, all] of Object.entries(BOT_TRAITS)) {
    const options = SEEDED_OPTIONS[name] ?? all
    state = nextRandom(state)
    traits[name] = options[state % options.length]
  }
  return traits
}

/**
 * Stored overrides laid over the seed's own picks; unknown names or values are dropped, so an
 * old or hand-edited record still draws a valid robot.
 */
export const resolveBotTraits = (seed, overrides) => {
  const traits = botTraitsFor(seed)
  for (const [name, options] of Object.entries(BOT_TRAITS)) {
    if (options.includes(overrides?.[name])) traits[name] = overrides[name]
  }
  return traits
}

/** Whether `value` is a complete, valid set of traits — the check a server stores behind. */
export const isBotTraits = (value) =>
  Boolean(value) && typeof value === 'object' && Object.entries(BOT_TRAITS).every(([name, options]) =>
    (OPTIONAL_TRAITS.includes(name) && value[name] === undefined) || options.includes(value[name]))

/** A fresh random set from everything on offer, network badges included, for a Shuffle button. */
export const randomBotTraits = () =>
  Object.fromEntries(Object.entries(BOT_TRAITS).map(([name, options]) => [name, options[Math.floor(Math.random() * options.length)]]))

// --- Drawing ---

// A sleeping robot keeps its colour, faded, so it is still recognisably itself
const paletteFor = (colorId, fade = 1) => {
  const { hue, sat } = BOT_COLORS.find((color) => color.id === colorId) ?? BOT_COLORS[0]
  const s = (value) => Math.round(value * sat * fade)
  return {
    bgTop: `hsl(${hue} ${s(90)}% 97%)`,
    bgBottom: `hsl(${hue} ${s(70)}% 91%)`,
    shellBottom: `hsl(${hue} ${s(72)}% 90%)`,
    stroke: `hsl(${hue} ${s(62)}% 84%)`,
    accent: `hsl(${hue} ${s(86)}% 72%)`,
    glowTop: `hsl(${hue} ${s(100)}% 84%)`,
    glowBottom: `hsl(${hue} ${s(80)}% 60%)`,
    line: `hsl(${hue} ${s(70)}% 56%)`,
    light: `hsl(${hue} ${s(100)}% 95%)`,
    // The anime portrait sits on a bold, flat field rather than the robot's pale wash
    vividTop: `hsl(${hue} ${s(92)}% 66%)`,
    vivid: `hsl(${hue} ${s(86)}% 58%)`,
  }
}

const EYE = '#2e2a3d'

const domeShell = (p) => `<path d="M146 214a110 110 0 0 1 220 0z" fill="#fff" fill-opacity=".55" stroke="${p.stroke}" stroke-width="6"/>`
const domeGlow = '<path d="M186 214c0-48 30-78 70-78s70 30 70 78z" fill="url(#glow)"/>'

const DOMES = {
  brain: (p) =>
    `${domeShell(p)}${domeGlow}<path d="M256 146v66M221 168c14 8 14 30 0 40M291 168c-14 8-14 30 0 40" fill="none" stroke="${p.light}" stroke-width="6" stroke-linecap="round"/>`,
  core: (p) => `${domeShell(p)}<circle cx="256" cy="172" r="36" fill="url(#glow)"/><circle cx="256" cy="172" r="15" fill="${p.light}"/>`,
  bolt: (p) => `${domeShell(p)}${domeGlow}<path d="M264 142l-32 42h22l-8 30 36-46h-22z" fill="${p.light}"/>`,
  chip: (p) =>
    `${domeShell(p)}<rect x="224" y="148" width="64" height="50" rx="10" fill="url(#glow)"/><path d="M238 148v-10M256 148v-10M274 148v-10M238 198v10M256 198v10M274 198v10" stroke="${p.line}" stroke-width="5" stroke-linecap="round"/><rect x="242" y="162" width="28" height="22" rx="5" fill="${p.light}"/>`,
  antenna: (p) => `<path d="M256 198v-58" stroke="${p.stroke}" stroke-width="8" stroke-linecap="round"/><circle cx="256" cy="128" r="18" fill="url(#glow)"/>`,
}

const EARS = {
  pods: (p) => `<rect x="86" y="236" width="40" height="96" rx="20" fill="${p.accent}"/><rect x="386" y="236" width="40" height="96" rx="20" fill="${p.accent}"/>`,
  antennas: (p) =>
    `<path d="M156 210l-38-62M356 210l38-62" stroke="${p.stroke}" stroke-width="7" stroke-linecap="round"/><circle cx="114" cy="140" r="13" fill="${p.accent}"/><circle cx="398" cy="140" r="13" fill="${p.accent}"/><rect x="96" y="256" width="30" height="56" rx="15" fill="${p.accent}"/><rect x="386" y="256" width="30" height="56" rx="15" fill="${p.accent}"/>`,
  headset: (p) =>
    `<rect x="80" y="230" width="48" height="108" rx="24" fill="${p.accent}"/><rect x="384" y="230" width="48" height="108" rx="24" fill="${p.accent}"/><path d="M128 312c26 40 70 52 104 50" fill="none" stroke="${p.line}" stroke-width="7" stroke-linecap="round"/><circle cx="236" cy="362" r="9" fill="${p.line}"/>`,
  none: () => '',
}

// Drawn before the dome so it sits behind the glass
const HEADBAND = (p) => `<path d="M104 240C104 92 408 92 408 240" fill="none" stroke="${p.line}" stroke-width="14" stroke-linecap="round"/>`

const pill = (x) => `<rect x="${x}" y="248" width="30" height="64" rx="15" fill="${EYE}"/><circle cx="${x + 12}" cy="262" r="5" fill="#fff" fill-opacity=".8"/>`
const happy = (x) => `<path d="M${x - 3} 290q18-28 36 0" fill="none" stroke="${EYE}" stroke-width="11" stroke-linecap="round"/>`

const EYES = {
  pill: () => `${pill(198)}${pill(284)}`,
  round: () =>
    `<circle cx="213" cy="280" r="22" fill="${EYE}"/><circle cx="299" cy="280" r="22" fill="${EYE}"/><circle cx="220" cy="272" r="6" fill="#fff" fill-opacity=".85"/><circle cx="306" cy="272" r="6" fill="#fff" fill-opacity=".85"/>`,
  happy: () => `${happy(198)}${happy(284)}`,
  visor: (p) =>
    `<rect x="172" y="256" width="168" height="48" rx="24" fill="${EYE}"/><rect x="198" y="271" width="32" height="18" rx="9" fill="${p.glowTop}"/><rect x="282" y="271" width="32" height="18" rx="9" fill="${p.glowTop}"/>`,
  sleepy: () => `<rect x="192" y="276" width="42" height="14" rx="7" fill="${EYE}"/><rect x="278" y="276" width="42" height="14" rx="7" fill="${EYE}"/>`,
  wink: () => `${pill(198)}${happy(284)}`,
}

const MOUTHS = {
  none: () => '',
  smile: () => `<path d="M236 334q20 18 40 0" fill="none" stroke="${EYE}" stroke-width="8" stroke-linecap="round"/>`,
  grill: (p) => `<rect x="226" y="326" width="60" height="20" rx="8" fill="${EYE}"/><path d="M241 326v20M256 326v20M271 326v20" stroke="${p.accent}" stroke-width="3"/>`,
  o: () => `<circle cx="256" cy="338" r="9" fill="${EYE}"/>`,
}

const CHESTS = {
  circuit: (p) => `<path d="M206 452h40l10 12h40" fill="none" stroke="${p.line}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`,
  heart: (p) => `<path d="M256 474l-22-21a13 13 0 0 1 22-19a13 13 0 0 1 22 19z" fill="${p.accent}"/>`,
  bolt: (p) => `<path d="M262 430l-22 30h16l-6 22 26-34h-16z" fill="${p.accent}"/>`,
  dots: (p) => `<circle cx="228" cy="456" r="8" fill="${p.accent}"/><circle cx="256" cy="456" r="8" fill="${p.line}"/><circle cx="284" cy="456" r="8" fill="${p.accent}"/>`,
  ...Object.fromEntries(Object.keys(BOT_NETWORK_BADGES).map((id) => [id, (p) => networkBadge(id, p)])),
}

const BADGE_X = 256
const BADGE_Y = 450
const BADGE_R = 31

/** A round network badge on the chest: a white rim, then the logo clipped to a circle. */
const networkBadge = (id, p) => {
  const { viewBox, markup, background, inset = 0 } = BOT_NETWORK_BADGES[id]
  const size = (BADGE_R - inset) * 2
  return [
    `<circle cx="${BADGE_X}" cy="${BADGE_Y}" r="${BADGE_R + 4}" fill="#fff" stroke="${p.stroke}" stroke-width="3"/>`,
    `<clipPath id="chest-badge"><circle cx="${BADGE_X}" cy="${BADGE_Y}" r="${BADGE_R}"/></clipPath>`,
    '<g clip-path="url(#chest-badge)">',
    background ? `<circle cx="${BADGE_X}" cy="${BADGE_Y}" r="${BADGE_R}" fill="${background}"/>` : '',
    `<svg x="${BADGE_X - size / 2}" y="${BADGE_Y - size / 2}" width="${size}" height="${size}" viewBox="${viewBox}">${markup}</svg>`,
    '</g>',
  ].join('')
}

const CHEEKS = {
  none: () => '',
  blush: () => '<circle cx="170" cy="322" r="15" fill="#ff7a9a" fill-opacity=".32"/><circle cx="342" cy="322" r="15" fill="#ff7a9a" fill-opacity=".32"/>',
}

// Asleep: both eyes shut whatever their style, and a "zzZ" drifting up from the head
const SLEEPING_EYES = `<path d="M196 290q17 12 34 0M282 290q17 12 34 0" fill="none" stroke="${EYE}" stroke-width="9" stroke-linecap="round"/>`
const SNORE = (p) =>
  [
    [356, 152, 16],
    [388, 112, 22],
    [428, 64, 30],
  ]
    .map(([x, y, size]) => `<path d="M${x} ${y}h${size}l-${size} ${size}h${size}" fill="none" stroke="${p.line}" stroke-width="${size / 4}" stroke-linecap="round" stroke-linejoin="round"/>`)
    .join('')

/**
 * The robot as an SVG string, 512×512.
 * @param {object} traits From botTraitsFor or resolveBotTraits; anything missing comes from the default robot.
 * @param {{background?: boolean, sleeping?: boolean}} [options] `background: false` leaves it
 *   transparent; `sleeping` draws it dozing — head down, eyes shut, faded, with a zzZ — for an agent
 *   that is switched off or out of credits.
 * @returns {string}
 */
export const botAvatarSvg = (traits, { background = true, sleeping = false } = {}) => {
  const t = resolveBotTraits('', { ...DEFAULT_BOT, ...traits })
  const p = paletteFor(t.color, sleeping ? 0.45 : 1)
  if (t.style === 'anime') return animeAvatarSvg(t, p, CHESTS[t.chest](p), { background, sleeping })

  return [
    // Keep the chest badge fully visible; sleeping robots also need room for the snore.
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${sleeping ? '32 56 448 448' : '48 88 416 416'}">`,
    '<defs>',
    `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.bgTop}"/><stop offset="1" stop-color="${p.bgBottom}"/></linearGradient>`,
    `<linearGradient id="shell" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="${p.shellBottom}"/></linearGradient>`,
    `<linearGradient id="glow" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.glowTop}"/><stop offset="1" stop-color="${p.glowBottom}"/></linearGradient>`,
    '</defs>',
    background ? '<rect width="512" height="512" fill="url(#bg)"/>' : '',
    `<rect x="166" y="372" width="180" height="160" rx="80" fill="url(#shell)" stroke="${p.stroke}" stroke-width="6"/>`,
    CHESTS[t.chest](p),
    // The head nods forward and down when asleep, pivoting on the neck
    sleeping ? '<g transform="rotate(-9 256 372) translate(0 18)">' : '<g>',
    t.ears === 'headset' ? HEADBAND(p) : '',
    DOMES[t.dome](p),
    `<rect x="116" y="196" width="280" height="176" rx="84" fill="url(#shell)" stroke="${p.stroke}" stroke-width="6"/>`,
    EARS[t.ears](p),
    CHEEKS[t.cheeks](p),
    sleeping ? SLEEPING_EYES : EYES[t.eyes](p),
    sleeping ? '' : MOUTHS[t.mouth](p),
    '</g>',
    sleeping ? SNORE(p) : '',
    '</svg>',
  ].join('')
}

/** The look before anything is picked: the lavender brain-dome bot. */
export const DEFAULT_BOT = Object.freeze({ color: 'lavender', dome: 'brain', ears: 'pods', eyes: 'pill', mouth: 'none', chest: 'circuit', cheeks: 'none' })

/** The robot as a data URI, for an <img src>. */
export const botAvatarDataUri = (traits, options) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(botAvatarSvg(traits, options))}`

/**
 * The robot as a PNG — what a profile picture needs, since pictures are moderated and that reads
 * raster images. Browser-only.
 * @returns {Promise<Blob>}
 */
export const botAvatarPng = (traits, size = 512) =>
  new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = size
      canvas.getContext('2d').drawImage(image, 0, 0, size, size)
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not draw the robot'))), 'image/png')
    }
    image.onerror = () => reject(new Error('Could not draw the robot'))
    image.src = botAvatarDataUri(traits)
  })
