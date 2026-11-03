'use client'

import { useId } from 'react'
import clsx from 'clsx'
import { HUP_MARK_PATH } from '@/components/ui/HupMark'
import styles from './Decorations.module.scss'

/* The artwork for each catalog id (config/decorations.js). Every piece is drawn for the box its
 * slot gives it in DecorationFrame.module.scss, in units of 1% of the avatar's diameter — so the
 * picture is the circle of radius 50 the coordinates below are laid out around.
 *
 * Inline rather than <img>, so a gradient can be scoped with useId and the motion lives in CSS
 * where reduced-motion can stop it. Only transform and opacity animate: a feed holds dozens of
 * these, and anything that repaints the path per frame would stall the scroll. */

/** Drawn over the picture's edge: a gradient ring with a breathing glow. */
const NeonRing = () => {
  const gradient = useId()
  return (
    <svg viewBox="0 0 120 120" className={styles.neonRing} aria-hidden="true">
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" className={styles.neonRing__stopStart} />
          <stop offset="1" className={styles.neonRing__stopEnd} />
        </linearGradient>
      </defs>
      <circle className={styles.neonRing__glow} cx="60" cy="60" r="53" stroke={`url(#${gradient})`} />
      <circle className={styles.neonRing__core} cx="60" cy="60" r="53" stroke={`url(#${gradient})`} />
    </svg>
  )
}

const BOLTS = [
  '103,41 112,33 107,30 119,19 114,17 127,7',
  '23,64 13,60 17,55 5,50 9,46 1,41',
  '98,113 105,123 100,125 108,137',
  '41,111 34,119 38,121 31,130',
]

/** Bolts striking off the rim, one after another. */
const Lightning = () => (
  <svg viewBox="0 0 144 144" className={styles.lightning} aria-hidden="true">
    {BOLTS.map((points, index) => (
      <g key={points} className={clsx(styles.lightning__bolt, styles[`lightning__bolt--${index + 1}`])}>
        <polyline className={styles.lightning__glow} points={points} />
        <polyline className={styles.lightning__core} points={points} />
      </g>
    ))}
  </svg>
)

// Fixed layers and negative delays give every avatar a full shower on its first frame.
const RAIN_DROPS = Array.from({ length: 18 }, (_, index) => ({
  x: 14 + (index * 37) % 112,
  y: 4 + (index * 23) % 84,
  length: 5 + index % 4,
  duration: 1.1 + (index % 5) * 0.17,
  delay: (index * 0.31) % 2,
}))

/** A light diagonal shower with small ripples underneath the portrait. */
const Rain = () => {
  const clip = useId()
  const water = useId()
  return (
    <svg viewBox="0 0 144 144" className={styles.rain} aria-hidden="true">
      <defs>
        <clipPath id={clip}>
          <circle cx="72" cy="72" r="66" />
        </clipPath>
        <linearGradient id={water} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" className={styles.rain__stopTail} />
          <stop offset="1" className={styles.rain__stopHead} />
        </linearGradient>
      </defs>
      <g clipPath={`url(#${clip})`}>
        {RAIN_DROPS.map((drop, index) => (
          <g
            key={index}
            className={clsx(styles.rain__drop, index % 3 === 0 && styles['rain__drop--distant'])}
            style={{ '--rain-duration': `${drop.duration}s`, '--rain-delay': `-${drop.delay}s` }}
          >
            <path
              className={styles.rain__trail}
              d={`M${drop.x} ${drop.y} l${drop.length * 0.3} ${drop.length}`}
              stroke={`url(#${water})`}
            />
          </g>
        ))}
        {[44, 74, 102].map((x, index) => (
          <ellipse
            key={x}
            className={styles.rain__splash}
            cx={x}
            cy={122 + index % 2 * 5}
            rx="6"
            ry="1.8"
            style={{ '--rain-delay': `-${index * 0.6}s` }}
          />
        ))}
      </g>
    </svg>
  )
}

/* The picture's own disc, cut out of the soft fire so the heat sits only past its edge. */
const SOFT_FIRE_HOLE = 'M23 72 A49 49 0 1 0 121 72 A49 49 0 1 0 23 72 Z'

/**
 * Curved flame tongues join into one continuous silhouette around the clear portrait.
 * Two different silhouettes cross-fade to roll the flame tips without repainting SVG paths.
 */
const softFireEdge = (phase) => {
  const count = 18
  const step = Math.PI * 2 / count
  const at = (angle, radius) => `${(72 + Math.sin(angle) * radius).toFixed(2)} ${(72 - Math.cos(angle) * radius).toFixed(2)}`
  const curve = Array.from({ length: count }, (_, index) => {
    const turn = index * step
    const tip = 58 + (1 + Math.sin(index * 2.4 + phase)) * 3.5 + Math.max(0, Math.cos(turn)) * 4
    return `C${at(turn + step * 0.12, 55)} ${at(turn + step * 0.24, tip - 4)} ${at(turn + step * 0.48, tip)} C${at(turn + step * 0.37, tip - 8)} ${at(turn + step * 0.82, 54)} ${at(turn + step, 52)}`
  }).join(' ')
  return `M${at(0, 52)} ${curve} Z ${SOFT_FIRE_HOLE}`
}

const SOFT_FIRE_EDGES = [softFireEdge(0), softFireEdge(Math.PI)]

/** A soft warm glow hugging the picture, its edge shimmering like heat. */
const SoftFire = () => {
  const heat = useId()
  return (
    <svg viewBox="0 0 144 144" className={styles.softFire} aria-hidden="true">
      <defs>
        {/* Clear at the picture's edge, brightest just past it, fading out to nothing */}
        <radialGradient id={heat} cx="72" cy="72" r="68" gradientUnits="userSpaceOnUse">
          <stop offset="0.71" className={styles.softFire__stopEdge} />
          <stop offset="0.75" className={styles.softFire__stopCore} />
          <stop offset="0.8" className={styles.softFire__stopWarm} />
          <stop offset="0.9" className={styles.softFire__stopHot} />
          <stop offset="1" className={styles.softFire__stopOut} />
        </radialGradient>
      </defs>
      <g className={styles.softFire__body}>
        {SOFT_FIRE_EDGES.map((d, index) => (
          <path
            key={index}
            className={clsx(styles.softFire__layer, index === 1 && styles['softFire__layer--alt'])}
            d={d}
            fill={`url(#${heat})`}
            fillRule="evenodd"
          />
        ))}
      </g>
      {[28, 44, 63, 82, 101, 117].map((x, index) => (
        <circle key={x} cx={x} cy={20 + index % 3 * 4} r={index % 2 ? 0.8 : 1.2} className={styles.softFire__ember} style={{ '--fire-delay': `-${index * 0.37}s` }} />
      ))}
    </svg>
  )
}

const CLOUD_SHAPE = 'M9 24 C-1 24 -2 11 8 9 C8 -2 25 -3 28 7 C36 3 43 10 41 16 C50 19 46 27 38 27 H11 C10 27 9 26 9 24 Z'
const CLOUD_LAYERS = [
  { x: 13, y: 28, scale: 0.85, delay: -2.2 },
  { x: 43, y: 9, scale: 1.15, delay: -0.8 },
  { x: 87, y: 22, scale: 0.95, delay: -3.6 },
]

/** Soft clouds drifting along the portrait's edges, leaving the face clear. */
const Clouds = () => {
  const gradient = useId()
  return (
    <svg viewBox="0 0 144 144" className={styles.clouds} aria-hidden="true">
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className={styles.clouds__stopLight} />
          <stop offset="0.5" className={styles.clouds__stopMiddle} />
          <stop offset="1" className={styles.clouds__stopShade} />
        </linearGradient>
      </defs>
      {CLOUD_LAYERS.map((cloud, index) => (
        <g key={index} transform={`translate(${cloud.x} ${cloud.y}) scale(${cloud.scale})`}>
          <g className={styles.clouds__drift} style={{ '--cloud-delay': `${cloud.delay}s` }}>
            <path className={styles.clouds__body} d={CLOUD_SHAPE} fill={`url(#${gradient})`} />
            <path className={styles.clouds__highlight} d="M9 10 C13 8 16 9 18 11 M30 9 C34 8 37 10 38 12" />
          </g>
        </g>
      ))}
    </svg>
  )
}

const SNOW_FLAKES = Array.from({ length: 16 }, (_, index) => ({
  x: 18 + (index * 19) % 108,
  y: 28 + (index * 17) % 62,
  duration: 2.8 + (index % 4) * 0.4,
  delay: index * 0.43,
}))

/** Frosted cloud cover with a gentle, staggered snowfall. */
const Snow = () => (
  <svg viewBox="0 0 144 144" className={styles.snow} aria-hidden="true">
    <Clouds />
    {SNOW_FLAKES.map((flake, index) => (
      <g key={index} transform={`translate(${flake.x} ${flake.y})`}>
        <g className={styles.snow__flake} style={{ '--snow-duration': `${flake.duration}s`, '--snow-delay': `-${flake.delay}s` }}>
          {index % 3 === 0
            ? <path className={styles.snow__crystal} d="M-2.5 0 H2.5 M0 -2.5 V2.5 M-1.8 -1.8 L1.8 1.8 M-1.8 1.8 L1.8 -1.8" />
            : <circle className={styles.snow__dot} r={index % 2 ? 1 : 1.5} />}
        </g>
      </g>
    ))}
  </svg>
)

/** A ring of light floating just above the picture. */
const Halo = () => (
  <svg viewBox="0 0 100 30" className={styles.halo} aria-hidden="true">
    <ellipse className={styles.halo__glow} cx="50" cy="15" rx="42" ry="9" />
    <ellipse className={styles.halo__core} cx="50" cy="15" rx="42" ry="9" />
  </svg>
)

/* One wing, the left; the right is the same group mirrored. The shoulder sits behind the picture,
   and the scalloped lower edge is the feather tips running back toward it. Swept up rather than
   out: the profile header sits near its card's clipped edge, and a wide span was cut off there. */
const WING_PRIMARIES = 'M56 62 C44 40 24 22 2 4 C6 14 6 22 4 30 C12 30 18 34 18 40 C24 40 30 44 30 50 C36 50 42 54 42 60 C46 60 50 62 52 66 Z'
const WING_COVERTS = 'M58 62 C48 46 36 34 20 26 C24 32 24 38 22 42 C28 42 34 46 34 52 C40 52 44 56 46 60 Z'

/** Feathered wings spreading from behind the picture, beating slowly. */
const AngelWings = () => {
  const gradient = useId()
  const wing = (
    <g className={styles.wings__wing}>
      <path className={styles.wings__primaries} d={WING_PRIMARIES} fill={`url(#${gradient})`} />
      <path className={styles.wings__coverts} d={WING_COVERTS} />
    </g>
  )
  return (
    <svg viewBox="0 0 160 100" className={styles.wings} aria-hidden="true">
      <defs>
        <linearGradient id={gradient} x1="1" y1="1" x2="0" y2="0">
          <stop offset="0" className={styles.wings__stopStart} />
          <stop offset="1" className={styles.wings__stopEnd} />
        </linearGradient>
      </defs>
      {wing}
      <g transform="matrix(-1 0 0 1 160 0)">{wing}</g>
    </svg>
  )
}

// Place the larger particles outside the portrait, with different sizes and phases.
const RIM_PARTICLES = [
  { x: 23, y: 37, scale: 0.8 },
  { x: 52, y: 17, scale: 0.55 },
  { x: 99, y: 22, scale: 1 },
  { x: 126, y: 57, scale: 0.65 },
  { x: 117, y: 103, scale: 0.9 },
  { x: 79, y: 126, scale: 0.5 },
  { x: 36, y: 117, scale: 0.75 },
  { x: 17, y: 80, scale: 0.6 },
]

const RimParticles = ({ variant, children }) => (
  <svg viewBox="0 0 144 144" className={clsx(styles.particles, styles[`particles--${variant}`])} aria-hidden="true">
    {RIM_PARTICLES.map((particle, index) => (
      <g key={index} transform={`translate(${particle.x} ${particle.y}) scale(${particle.scale})`}>
        <g className={styles.particles__motion} style={{ '--particle-delay': `-${index * 0.61}s`, '--particle-duration': `${3 + index % 3 * 0.7}s` }}>
          {children}
        </g>
      </g>
    ))}
  </svg>
)

const Starlight = () => (
  <RimParticles variant="starlight">
    <path className={styles.particles__starGlow} d="M0 -10 Q2 -2 10 0 Q2 2 0 10 Q-2 2 -10 0 Q-2 -2 0 -10Z" />
    <path className={styles.particles__star} d="M0 -7 Q1 -1 7 0 Q1 1 0 7 Q-1 1 -7 0 Q-1 -1 0 -7Z" />
    <circle className={styles.particles__star} cx="10" cy="-8" r="1" />
  </RimParticles>
)

const Bubbles = () => (
  <RimParticles variant="bubbles">
    <circle className={styles.particles__bubble} r="7" />
    <path className={styles.particles__bubbleShine} d="M-4 -1 A4 4 0 0 1 0 -4" />
    <path className={styles.particles__bubbleTint} d="M1 5 A5 5 0 0 0 5 1" />
    <circle className={styles.particles__bubble} cx="9" cy="9" r="2" />
  </RimParticles>
)

const Hearts = () => (
  <RimParticles variant="hearts">
    <path className={styles.particles__heart} d="M0 7 C-3 4 -9 0 -7 -4 C-5 -8 -1 -7 0 -4 C1 -7 5 -8 7 -4 C9 0 3 4 0 7Z" />
    <path className={styles.particles__heartShine} d="M-5 -2 Q-5 -5 -2 -4" />
  </RimParticles>
)

const Halloween = () => (
  <svg viewBox="0 0 144 144" className={styles.halloween} aria-hidden="true">
    {[{ x: 27, y: 110, scale: 1 }, { x: 117, y: 101, scale: 0.8 }].map((pumpkin, index) => (
      <g key={index} transform={`translate(${pumpkin.x} ${pumpkin.y}) scale(${pumpkin.scale})`}>
        <g className={styles.halloween__pumpkin} style={{ '--halloween-delay': `-${index * 1.7}s` }}>
          <path className={styles.halloween__stem} d="M-1 -10 Q-3 -17 3 -17 L4 -14 Q0 -14 2 -10Z" />
          <path className={styles.halloween__body} d="M0 -10 C-19 -16 -21 11 -8 13 Q0 16 8 13 C21 11 19 -16 0 -10Z" />
          <path className={styles.halloween__ribs} d="M-5 -10 C-11 -4 -11 8 -5 13 M5 -10 C11 -4 11 8 5 13" />
          <path className={styles.halloween__face} d="M-10 -1 L-4 -5 L-3 1Z M10 -1 L4 -5 L3 1Z M-9 5 L-4 7 L-2 5 L1 8 L4 5 L9 5 Q0 17 -9 5Z" />
        </g>
      </g>
    ))}
    {[{ x: 30, y: 28, scale: 0.9 }, { x: 108, y: 23, scale: 0.7 }, { x: 127, y: 60, scale: 0.5 }].map((bat, index) => (
      <g key={index} transform={`translate(${bat.x} ${bat.y}) scale(${bat.scale})`}>
        <g className={styles.halloween__bat} style={{ '--halloween-delay': `-${index * 0.8}s` }}>
          <path className={styles.halloween__wings} d="M-3 0 L-4 -5 L0 -2 L4 -5 L3 0 Q11 -9 20 -7 Q15 -1 18 5 Q10 2 8 9 Q3 5 0 9 Q-3 5 -8 9 Q-10 2 -18 5 Q-15 -1 -20 -7 Q-11 -9 -3 0Z" />
          <circle className={styles.halloween__eyes} cx="-1.7" cy="2" r="0.8" />
          <circle className={styles.halloween__eyes} cx="1.7" cy="2" r="0.8" />
        </g>
      </g>
    ))}
  </svg>
)

/** A transparent nebula around the rim, with tilted orbits and scattered stars. */
const Galaxy = () => {
  const nebula = useId()
  const orbit = useId()
  return (
    <svg viewBox="0 0 144 144" className={styles.galaxy} aria-hidden="true">
      <defs>
        <radialGradient id={nebula}>
          <stop offset="0.66" className={styles.galaxy__clear} />
          <stop offset="0.76" className={styles.galaxy__violet} />
          <stop offset="0.85" className={styles.galaxy__blue} />
          <stop offset="1" className={styles.galaxy__clear} />
        </radialGradient>
        <linearGradient id={orbit} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" className={styles.galaxy__orbitBlue} />
          <stop offset="0.5" className={styles.galaxy__orbitPink} />
          <stop offset="1" className={styles.galaxy__orbitBlue} />
        </linearGradient>
      </defs>
      <circle className={styles.galaxy__nebula} cx="72" cy="72" r="70" fill={`url(#${nebula})`} />
      <g transform="rotate(-28 72 72)">
        <ellipse className={styles.galaxy__orbit} cx="72" cy="72" rx="67" ry="43" stroke={`url(#${orbit})`} />
        <path className={styles.galaxy__arc} d="M5 72 A67 43 0 0 0 72 115" stroke={`url(#${orbit})`} />
        <circle className={styles.galaxy__planet} cx="119" cy="103" r="3" />
      </g>
      {RIM_PARTICLES.map((star, index) => (
        <g key={index} transform={`translate(${star.x} ${star.y}) scale(${star.scale})`}>
          <g className={styles.galaxy__star} style={{ '--galaxy-delay': `-${index * 0.47}s` }}>
            <path d="M0 -3 L0.8 -0.8 L3 0 L0.8 0.8 L0 3 L-0.8 0.8 L-3 0 L-0.8 -0.8Z" />
            <circle cx="6" cy="-5" r="0.7" />
          </g>
        </g>
      ))}
    </svg>
  )
}

const Sun = () => {
  const glow = useId()
  return (
    <svg viewBox="0 0 144 144" className={styles.sun} aria-hidden="true">
      <defs>
        <radialGradient id={glow}>
          <stop offset="0" className={styles.sun__glowCore} />
          <stop offset="1" className={styles.sun__glowEdge} />
        </radialGradient>
      </defs>
      <g className={styles.sun__body}>
        <circle className={styles.sun__glow} cx="105" cy="28" r="31" fill={`url(#${glow})`} />
        <g className={styles.sun__rays}>
          {Array.from({ length: 10 }, (_, index) => (
            <path key={index} d="M105 7 V2" transform={`rotate(${index * 36} 105 28)`} />
          ))}
        </g>
        <circle className={styles.sun__disc} cx="105" cy="28" r="14" />
        <path className={styles.sun__shine} d="M96 26 A9 9 0 0 1 103 19" />
      </g>
      <path className={styles.sun__rim} d="M20 61 A53 53 0 0 1 75 19" />
    </svg>
  )
}

const Coffee = () => (
  <svg viewBox="0 0 144 144" className={styles.coffee} aria-hidden="true">
    <g transform="translate(93 101)">
      <ellipse className={styles.coffee__saucer} cx="14" cy="28" rx="23" ry="4" />
      <path className={styles.coffee__handle} d="M29 6 H34 C46 6 44 22 30 21" />
      <path className={styles.coffee__cup} d="M-3 4 H31 L28 22 Q14 33 0 22Z" />
      {/* The Hup mark printed on the cup: its 51-unit box scaled to about 11, centred on the body */}
      <path className={styles.coffee__logo} d={HUP_MARK_PATH} fillRule="evenodd" transform="translate(8.4 9.6) scale(0.22)" />
      <ellipse className={styles.coffee__rim} cx="14" cy="4" rx="17" ry="5" />
      <ellipse className={styles.coffee__drink} cx="14" cy="4" rx="13" ry="3" />
      <path className={styles.coffee__foam} d="M14 6 C8 3 10 0 14 2 C18 0 20 3 14 6Z" />
      {[4, 14, 24].map((x, index) => (
        <path key={x} className={styles.coffee__steam} d={`M${x} -4 C${x - 7} -10 ${x + 7} -15 ${x} -22`} style={{ '--steam-delay': `-${index * 0.8}s` }} />
      ))}
    </g>
    <g transform="translate(24 35) rotate(-30)">
      <ellipse className={styles.coffee__bean} rx="5" ry="8" />
      <path className={styles.coffee__beanLine} d="M0 -6 C-4 -2 4 2 0 6" />
    </g>
  </svg>
)

/** Layered surf hugs the lower rim, with translucent water over the portrait's edge. */
const Sea = () => {
  const clip = useId()
  const water = useId()
  return (
    <svg viewBox="0 0 144 144" className={styles.sea} aria-hidden="true">
      <defs>
        <clipPath id={clip}>
          <circle cx="72" cy="72" r="59" />
        </clipPath>
        <linearGradient id={water} x1="72" y1="77" x2="72" y2="135" gradientUnits="userSpaceOnUse">
          <stop offset="0" className={styles.sea__surface} />
          <stop offset="0.55" className={styles.sea__middle} />
          <stop offset="1" className={styles.sea__depth} />
        </linearGradient>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <g transform="translate(0 -10)">
          <path className={styles.sea__back} d="M-25 108 C0 98 17 99 38 105 S72 112 92 103 S128 92 160 106 L170 145 H-25Z" />
          <path className={styles.sea__middleWave} d="M-25 116 C8 102 21 107 44 112 S80 101 101 107 S133 116 170 103 V145 H-25Z" />
          <g className={styles.sea__crest}>
            <path d="M17 112 C8 98 12 79 26 77 C39 74 49 87 40 95 C42 87 35 82 29 87 C19 98 39 109 65 113 L62 136 H17Z" fill={`url(#${water})`} />
            <path className={styles.sea__crestFoam} d="M16 95 C14 84 20 78 27 78 C36 77 44 85 40 93 C39 86 34 84 29 87" />
            <path className={styles.sea__trail} d="M21 97 C22 106 32 111 44 114 M24 101 C28 107 36 109 40 110" />
          </g>
          <g className={styles.sea__front}>
            <path d="M-25 119 C1 107 24 110 46 117 S77 111 96 115 S131 123 170 110 V145 H-25Z" fill={`url(#${water})`} />
            <path className={styles.sea__foam} d="M-25 119 C1 107 24 110 46 117 S77 111 96 115 S131 123 170 110" />
            <path className={styles.sea__trail} d="M39 124 Q47 127 57 125 M69 120 Q76 118 84 120 M96 126 Q105 129 113 126" />
            {[{ x: 49, y: 121 }, { x: 58, y: 123 }, { x: 91, y: 119 }, { x: 107, y: 123 }].map((foam, index) => (
              <circle key={index} className={styles.sea__fleck} cx={foam.x} cy={foam.y} r={index % 2 ? 0.6 : 1} />
            ))}
          </g>
        </g>
      </g>
      {[{ x: 19, y: 66, r: 1.5 }, { x: 117, y: 85, r: 2 }, { x: 125, y: 98, r: 1.3 }].map((bubble, index) => (
        <circle key={index} className={styles.sea__bubble} cx={bubble.x} cy={bubble.y} r={bubble.r} style={{ '--sea-delay': `-${index * 0.9}s` }} />
      ))}
    </svg>
  )
}

const Devil = () => {
  const horn = useId()
  const glow = useId()
  return (
    <svg viewBox="0 0 144 144" className={styles.devil} aria-hidden="true">
      <defs>
        <linearGradient id={horn} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" className={styles.devil__hornLight} />
          <stop offset="1" className={styles.devil__hornDark} />
        </linearGradient>
        <radialGradient id={glow}>
          <stop offset="0.68" className={styles.devil__glowClear} />
          <stop offset="0.79" className={styles.devil__glowRed} />
          <stop offset="1" className={styles.devil__glowClear} />
        </radialGradient>
      </defs>
      <circle className={styles.devil__aura} cx="72" cy="72" r="67" fill={`url(#${glow})`} />
      <g className={styles.devil__tail}>
        <path className={styles.devil__tailLine} d="M103 115 C122 127 137 115 127 101 C120 91 128 83 135 84" />
        <path className={styles.devil__tip} d="M129 77 L142 83 L131 92 L133 84Z" />
      </g>
      <path className={styles.devil__horn} d="M29 38 C17 27 21 12 29 4 C26 19 36 19 44 26Z" fill={`url(#${horn})`} />
      <path className={styles.devil__horn} d="M115 38 C127 27 123 12 115 4 C118 19 108 19 100 26Z" fill={`url(#${horn})`} />
      <path className={styles.devil__shine} d="M28 28 Q24 21 26 14 M116 28 Q120 21 118 14" />
    </svg>
  )
}

const Snake = () => (
  <svg viewBox="0 0 144 144" className={styles.snake} aria-hidden="true">
    <g className={styles.snake__body}>
      <path className={styles.snake__outline} d="M108 31 C85 8 49 12 28 34 C5 58 10 94 30 115 C52 137 90 136 113 113 C134 92 132 66 121 48" />
      <path className={styles.snake__skin} d="M108 31 C85 8 49 12 28 34 C5 58 10 94 30 115 C52 137 90 136 113 113 C134 92 132 66 121 48" />
      <path className={styles.snake__belly} d="M103 30 C82 12 50 16 30 36 C9 59 14 93 33 113 C54 133 89 132 110 111 C129 92 128 69 120 55" />
      <path className={styles.snake__scales} d="M95 21 L93 25 M78 17 V22 M60 19 L61 24 M43 25 L46 29 M27 38 L31 41 M17 54 L22 56 M15 73 H20 M19 92 L24 90 M29 109 L33 106 M46 125 L49 121 M64 130 L65 125 M83 128 L82 123 M101 121 L98 117 M118 103 L113 101 M127 84 H122 M125 66 L120 68" />
      <path className={styles.snake__head} d="M117 58 C109 52 109 42 115 35 Q120 29 125 36 C133 43 131 52 126 58Z" />
      <ellipse className={styles.snake__eye} cx="116" cy="42" rx="1.6" ry="2" />
      <ellipse className={styles.snake__eye} cx="125" cy="42" rx="1.6" ry="2" />
      <path className={styles.snake__tongue} d="M120 34 V27 M120 27 L117 24 M120 27 L123 24" />
    </g>
  </svg>
)

const Ghost = () => {
  const mist = useId()
  return (
    <svg viewBox="0 0 144 144" className={styles.ghost} aria-hidden="true">
      <defs>
        <linearGradient id={mist} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className={styles.ghost__light} />
          <stop offset="1" className={styles.ghost__fade} />
        </linearGradient>
      </defs>
      <ellipse className={styles.ghost__shadow} cx="121" cy="121" rx="15" ry="3" />
      <g className={styles.ghost__body}>
        <path className={styles.ghost__outline} d="M105 116 V91 C105 69 135 69 135 91 V116 Q130 109 125 116 Q120 110 115 116 Q110 110 105 116Z" fill={`url(#${mist})`} />
        <ellipse className={styles.ghost__eye} cx="115" cy="91" rx="2" ry="3" />
        <ellipse className={styles.ghost__eye} cx="126" cy="91" rx="2" ry="3" />
        <path className={styles.ghost__smile} d="M117 99 Q121 103 125 99" />
        <path className={styles.ghost__shine} d="M110 86 Q112 79 118 79" />
      </g>
    </svg>
  )
}

const SolarSystem = () => {
  const shade = useId()
  return (
    <svg viewBox="0 0 144 144" className={styles.solar} aria-hidden="true">
      <defs>
        <radialGradient id={shade} cx="30%" cy="25%" r="80%">
          <stop offset="0" stopColor="#fff" stopOpacity="0.45" />
          <stop offset="0.45" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#0f172a" stopOpacity="0.4" />
        </radialGradient>
      </defs>
      <circle className={styles.solar__track} cx="72" cy="72" r="58" />
      <circle className={styles.solar__outerTrack} cx="72" cy="72" r="64" />
      <g className={clsx(styles.solar__orbit, styles['solar__orbit--earth'])}>
        <circle className={styles.solar__earth} cx="72" cy="14" r="8" />
        <path className={styles.solar__land} d="M67 8 L72 7 L75 12 L72 15 L74 21 L68 19 L69 14 L65 12Z" />
        <circle cx="72" cy="14" r="8" fill={`url(#${shade})`} />
        <circle className={styles.solar__moon} cx="85" cy="11" r="2.5" />
      </g>
      <g className={clsx(styles.solar__orbit, styles['solar__orbit--saturn'])}>
        <g transform="rotate(-25 72 132)">
          <ellipse className={styles.solar__rings} cx="72" cy="132" rx="14" ry="5" />
          <circle className={styles.solar__saturn} cx="72" cy="132" r="7.5" />
          <circle cx="72" cy="132" r="7.5" fill={`url(#${shade})`} />
          <path className={styles.solar__rings} d="M58 132 A14 5 0 0 0 86 132" />
        </g>
      </g>
      <g className={clsx(styles.solar__orbit, styles['solar__orbit--mars'])}>
        <circle className={styles.solar__mars} cx="14" cy="72" r="6" />
        <circle className={styles.solar__crater} cx="12" cy="70" r="1.8" />
        <circle cx="14" cy="72" r="6" fill={`url(#${shade})`} />
      </g>
      <g className={clsx(styles.solar__orbit, styles['solar__orbit--sun'])}>
        <circle className={styles.solar__sunGlow} cx="130" cy="72" r="12" />
        <circle className={styles.solar__sun} cx="130" cy="72" r="7" />
        <circle cx="130" cy="72" r="7" fill={`url(#${shade})`} />
      </g>
      <g className={clsx(styles.solar__orbit, styles['solar__orbit--jupiter'])}>
        <circle className={styles.solar__jupiter} cx="72" cy="8" r="7.5" />
        <path className={styles.solar__bands} d="M66 4 Q72 6 78 4 M65 8 Q72 10 79 8 M67 12 Q72 14 77 12" />
        <ellipse className={styles.solar__spot} cx="75" cy="10" rx="2" ry="1" />
        <circle cx="72" cy="8" r="7.5" fill={`url(#${shade})`} />
      </g>
      <g className={clsx(styles.solar__orbit, styles['solar__orbit--neptune'])}>
        <circle className={styles.solar__neptune} cx="72" cy="136" r="5.5" />
        <path className={styles.solar__cloudBand} d="M68 134 Q72 132 76 134" />
        <circle cx="72" cy="136" r="5.5" fill={`url(#${shade})`} />
      </g>
    </svg>
  )
}

const Butterflies = () => {
  const color = useId()
  const wing = (
    <g className={styles.butterflyWings__wing}>
      <path className={styles.butterflyWings__edge} d="M61 62 C47 34 22 -2 5 5 C-7 21 6 55 30 64 C7 66 7 90 23 96 C42 102 58 80 61 62Z" fill={`url(#${color})`} />
      <path className={styles.butterflyWings__innerGlow} d="M57 62 C42 39 23 15 12 13 M56 68 Q31 92 20 84" />
      <path className={styles.butterflyWings__veins} d="M61 62 Q31 44 9 12 M61 62 Q28 58 10 32 M61 62 Q37 72 22 90 M61 62 Q37 79 37 92" />
      <path className={styles.butterflyWings__panel} d="M48 54 C35 32 20 15 13 16 C12 30 24 47 48 54Z M49 72 Q25 67 20 80 Q23 91 34 84Z" />
      <g className={styles.butterflyWings__spots}>
        <circle cx="8" cy="18" r="2" />
        <circle cx="9" cy="30" r="1.7" />
        <circle cx="14" cy="44" r="1.8" />
        <circle cx="21" cy="55" r="1.5" />
        <circle cx="18" cy="83" r="1.6" />
        <circle cx="26" cy="91" r="1.8" />
      </g>
    </g>
  )
  return (
    <svg viewBox="0 0 160 100" className={styles.butterflyWings} aria-hidden="true">
      <defs>
        <linearGradient id={color} x1="1" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#7c3aed" />
          <stop offset="0.55" stopColor="#c084fc" />
          <stop offset="1" stopColor="#f9a8d4" />
        </linearGradient>
      </defs>
      {wing}
      <g transform="matrix(-1 0 0 1 160 0)">{wing}</g>
    </svg>
  )
}

const Sakura = () => (
  <RimParticles variant="sakura">
    <g className={styles.extras__pink}>
      {[0, 72, 144, 216, 288].map((angle) => <path key={angle} transform={`rotate(${angle})`} d="M0 0 C-8 -4 -7 -13 -2 -11 L0 -9 L2 -11 C7 -13 8 -4 0 0Z" />)}
    </g>
    <path className={styles.extras__stamens} d="M0 0 L0 -4 M0 0 L4 -1 M0 0 L2 3 M0 0 L-3 3 M0 0 L-4 -2" />
    <circle cx="0" cy="0" r="1.5" className={styles.extras__gold} />
  </RimParticles>
)

const Aurora = () => {
  const light = useId()
  return (
    <svg viewBox="0 0 144 144" className={styles.extras} aria-hidden="true">
      <defs><linearGradient id={light}><stop offset="0" stopColor="#34d399" /><stop offset="0.5" stopColor="#22d3ee" /><stop offset="1" stopColor="#a78bfa" /></linearGradient></defs>
      <g className={styles.extras__auroraFlow} fill="none" stroke={`url(#${light})`}>
        <path strokeWidth="12" opacity="0.18" d="M19 100 C-5 19 65 -1 104 23 S148 82 113 119" />
        <path strokeWidth="3" opacity="0.75" d="M19 100 C-5 19 65 -1 104 23 S148 82 113 119" />
        <path strokeWidth="1.5" opacity="0.6" d="M26 113 C2 56 27 10 66 17 S146 50 122 103" />
        <path strokeWidth="4" opacity="0.3" d="M22 88 C8 29 52 2 92 24 S141 75 118 112" />
      </g>
    </svg>
  )
}

const Music = () => (
  <RimParticles variant="music">
    <path className={styles.extras__note} d="M-1 -9 L9 -12 V2 A4 3 0 1 1 7 -1 V-7 L1 -5 V6 A4 3 0 1 1 -1 3Z" />
  </RimParticles>
)

const Cat = () => (
  <svg viewBox="0 0 144 144" className={styles.extras} aria-hidden="true">
    <path className={styles.extras__catEar} d="M26 38 L22 5 Q41 8 49 23Z M95 23 Q103 8 122 5 L118 38Z" />
    <path className={styles.extras__pink} d="M29 28 L27 12 L41 23Z M103 23 L117 12 L115 28Z" />
    <path className={styles.extras__catFur} d="M28 29 L30 19 L35 26 M109 26 L114 19 L116 29" />
    <path className={styles.extras__tail} d="M100 119 C125 136 140 116 128 101 C119 89 132 78 135 88" />
  </svg>
)

const Cyber = () => {
  const light = useId()
  return (
    <svg viewBox="0 0 144 144" className={styles.cyber} aria-hidden="true">
      <defs>
        <linearGradient id={light} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#22d3ee" />
          <stop offset="0.5" stopColor="#818cf8" />
          <stop offset="1" stopColor="#e879f9" />
        </linearGradient>
      </defs>
      <path className={styles.cyber__base} d="M49 15 H95 L129 49 V95 L95 129 H49 L15 95 V49Z" />
      <path className={styles.cyber__frame} d="M49 15 H95 L129 49 V95 L95 129 H49 L15 95 V49Z" stroke={`url(#${light})`} />
      <path className={styles.cyber__corners} d="M35 25 L47 13 H61 M83 13 H97 L109 25 M131 83 V97 L119 109 M109 119 L97 131 H83 M61 131 H47 L35 119 M13 61 V47 L25 35" stroke={`url(#${light})`} />
      <circle className={styles.cyber__scanner} cx="72" cy="72" r="53" />
      <g className={styles.cyber__lights}>
        <path d="M58 8 H66 M70 8 H78 M82 8 H86 M58 136 H66 M70 136 H78" />
        <circle cx="9" cy="76" r="1.5" />
        <circle cx="135" cy="68" r="1.5" />
      </g>
    </svg>
  )
}

const Jellyfish = () => (
  <svg viewBox="0 0 144 144" className={styles.extras} aria-hidden="true">
    <g className={styles.extras__float}>
      <path className={styles.extras__tentacles} d="M110 94 C100 105 118 110 108 123 M118 95 C127 107 109 115 119 130 M126 94 C137 103 121 111 130 121" />
      <path className={styles.extras__jelly} d="M101 94 C100 64 137 64 136 94 Q130 99 125 94 Q119 100 113 94 Q107 100 101 94Z" />
      <path className={styles.extras__jellyRibs} d="M110 94 Q105 79 118 75 Q130 78 128 94 M118 75 Q114 85 118 96" />
      <path className={styles.extras__detail} d="M107 86 Q109 77 116 77" />
      <circle className={styles.extras__jellySpot} cx="109" cy="89" r="1.4" />
      <circle className={styles.extras__jellySpot} cx="128" cy="87" r="1.2" />
    </g>
  </svg>
)

const Dragon = () => {
  const scales = useId()
  return (
    <svg viewBox="0 0 144 144" className={styles.dragon} aria-hidden="true">
      <defs>
        <linearGradient id={scales} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#115e59" />
          <stop offset="0.5" stopColor="#14b8a6" />
          <stop offset="1" stopColor="#5eead4" />
        </linearGradient>
      </defs>
      <path className={styles.dragon__body} d="M24 108 C47 129 85 128 105 109 C119 95 118 73 112 58 L123 53 C140 82 133 108 112 123 C82 145 44 134 24 108Z" fill={`url(#${scales})`} />
      <path className={styles.dragon__belly} d="M43 123 C69 137 99 127 114 110 C127 93 126 74 121 65" />
      <path className={styles.dragon__spines} d="M56 131 L61 140 L68 134 M80 134 L88 141 L93 132 M104 126 L115 131 L117 117 M129 103 L139 99 L132 92 M131 78 L138 71 L128 69" />
      <g className={styles.dragon__wing}>
        <path className={styles.dragon__membrane} d="M115 88 C110 65 114 43 138 25 L134 51 L142 66 L130 64 L135 81 L122 75Z" />
        <path className={styles.dragon__veins} d="M115 88 L138 25 M119 67 L134 51 M119 67 L142 66 M119 67 L135 81" />
      </g>
      <g className={styles.dragon__head}>
        <path className={styles.dragon__horns} d="M112 39 L106 23 L118 34 M122 32 L125 17 L129 36" />
        <path className={styles.dragon__face} d="M110 42 Q111 30 122 33 Q132 34 132 43 L141 47 L139 55 L130 57 L122 64 L112 56Z" fill={`url(#${scales})`} />
        <path className={styles.dragon__brow} d="M119 41 L129 43" />
        <path className={styles.dragon__eye} d="M120 43 Q124 41 128 44 Q124 49 120 43Z" />
        <path className={styles.dragon__pupil} d="M124 43 V46" />
        <path className={styles.dragon__mouth} d="M127 53 L138 52" />
        <path className={styles.dragon__fang} d="M131 53 L133 57 L135 53Z" />
        <circle className={styles.dragon__nostril} cx="136" cy="48" r="1" />
      </g>
    </svg>
  )
}

const TopHat = () => {
  const satin = useId()
  return (
    <svg viewBox="0 0 100 30" className={styles.topHat} aria-hidden="true">
      <defs>
        <linearGradient id={satin}>
          <stop offset="0" className={styles.topHat__dark} />
          <stop offset="0.35" className={styles.topHat__light} />
          <stop offset="1" className={styles.topHat__dark} />
        </linearGradient>
      </defs>
      <g className={styles.topHat__body}>
        <ellipse className={styles.topHat__brim} cx="50" cy="25" rx="31" ry="4" />
        <path className={styles.topHat__crown} d="M29 3 Q50 -1 71 3 L67 24 Q50 28 33 24Z" fill={`url(#${satin})`} />
        <ellipse className={styles.topHat__top} cx="50" cy="3" rx="21" ry="2.5" />
        <path className={styles.topHat__band} d="M32 18 Q50 22 68 18 L67 24 Q50 28 33 24Z" />
        <rect className={styles.topHat__buckle} x="47" y="20" width="6" height="5" rx="0.8" />
        <path className={styles.topHat__shine} d="M35 7 L37 16 M24 25 Q30 27 39 27" />
      </g>
    </svg>
  )
}

const GoldenDragon = () => {
  const gold = useId()
  return (
    <svg viewBox="0 0 144 144" className={styles.goldenDragon} aria-hidden="true">
      <defs>
        <linearGradient id={gold} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff1a8" />
          <stop offset="0.4" stopColor="#fbbf24" />
          <stop offset="0.75" stopColor="#d97706" />
          <stop offset="1" stopColor="#fde68a" />
        </linearGradient>
      </defs>
      <g className={styles.goldenDragon__orbit}>
        <path className={styles.goldenDragon__spines} d="M31 119 L29 129 L40 126 M53 130 L58 139 L64 131 M82 131 L91 139 L95 127 M113 116 L125 119 L122 107 M127 94 L138 89 L129 82 M126 69 L134 60 L124 58 M30 34 L22 24 L23 42 M16 55 L7 60 L14 67 M17 84 L8 94 L23 98" />
        <path className={styles.goldenDragon__outline} d="M106 29 C78 8 45 15 26 39 C7 63 14 97 34 115 C58 137 92 132 114 111 C134 90 131 65 120 48" />
        <path className={styles.goldenDragon__coil} d="M106 29 C78 8 45 15 26 39 C7 63 14 97 34 115 C58 137 92 132 114 111 C134 90 131 65 120 48" stroke={`url(#${gold})`} />
        <path className={styles.goldenDragon__scales} d="M100 28 C77 13 47 20 30 41 C12 64 18 94 37 112 C60 132 91 127 110 108 C128 89 127 67 118 54" />
        <path className={styles.goldenDragon__mane} d="M115 34 Q107 30 100 32 L105 40 Q96 42 99 49 L105 48 Q99 57 103 64 L111 58 Q108 68 116 73 L121 62 Q131 67 135 60 L128 52Z" />
        <path className={styles.goldenDragon__maneDetail} d="M108 39 Q102 42 104 45 M110 49 Q105 55 107 59 M116 57 L115 65" />
        <path className={styles.goldenDragon__horns} d="M113 37 C107 30 111 20 103 16 M109 26 L101 23 M124 35 C125 25 134 23 132 15 M129 24 L137 20" />
        <path className={styles.goldenDragon__head} d="M108 42 Q110 33 120 34 Q128 34 130 41 L139 40 Q145 42 141 48 L134 51 L139 53 Q139 59 131 60 L122 58 Q116 65 110 57 Q104 50 108 42Z" fill={`url(#${gold})`} />
        <path className={styles.goldenDragon__cheek} d="M110 50 Q112 59 120 55 M126 40 Q130 45 135 44" />
        <path className={styles.goldenDragon__mouth} d="M122 50 Q130 53 140 47 L135 55 Q127 57 122 50Z" />
        <path className={styles.goldenDragon__fangs} d="M129 51 L130 55 L133 51 M136 49 L136 53 L138 48Z" />
        <path className={styles.goldenDragon__eye} d="M113 42 Q119 41 124 45 Q117 51 113 42Z" />
        <ellipse className={styles.goldenDragon__pupil} cx="119" cy="45" rx="1" ry="2" />
        <path className={styles.goldenDragon__brow} d="M111 39 Q116 38 124 43" />
        <ellipse className={styles.goldenDragon__nostril} cx="138" cy="44" rx="1.6" ry="1" />
        <path className={styles.goldenDragon__whiskers} d="M135 48 C145 53 146 66 136 69 M130 55 C130 69 116 77 112 70 M137 42 Q145 34 137 31" />
        <path className={styles.goldenDragon__beard} d="M125 58 Q128 67 120 71 L122 63 L117 67 L120 58Z" />
        <path className={styles.goldenDragon__claws} d="M39 111 L42 101 L46 97 M42 101 L48 103 M107 112 L99 103 L94 102 M99 103 L98 98" />
      </g>
    </svg>
  )
}

function FluffyKitten() {
  return (
    <svg viewBox="0 0 144 144" fill="none" aria-hidden="true">
      <g className={styles.kitten__ears} strokeLinejoin="round">
        <path d="M23 43 L16 9 Q34 11 48 27 L40 28 L41 33 L34 32 L35 38 L29 37Z" fill="#f7fcff" stroke="#7585a4" strokeWidth="1.5" />
        <path d="M121 43 L128 9 Q110 11 96 27 L104 28 L103 33 L110 32 L109 38 L115 37Z" fill="#f7fcff" stroke="#7585a4" strokeWidth="1.5" />
        <path d="M24 33 L22 17 Q32 20 39 27 L33 27 L34 31 L28 29Z" fill="#f4b6cf" />
        <path d="M120 33 L122 17 Q112 20 105 27 L111 27 L110 31 L116 29Z" fill="#f4b6cf" />
        <path d="M22 38 L25 32 L29 35 M122 38 L119 32 L115 35" stroke="#c3e1ef" strokeWidth="2" strokeLinecap="round" />
      </g>
      <g className={styles.kitten__tail}>
        <path d="M100 119 C119 127 132 118 126 107 C119 95 123 86 135 83 L132 88 L138 87 L135 93 L139 94 Q129 96 134 106 C145 128 125 141 106 132 L108 129 L101 128 L104 125 L98 123Z" fill="#f7fcff" stroke="#7585a4" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M105 125 Q126 136 133 120 Q137 112 131 104 Q125 93 133 90" stroke="#c3e1ef" strokeWidth="3" strokeLinecap="round" />
      </g>
    </svg>
  )
}

function NineTailedFox() {
  const maskId = useId()
  const pairs = [
    {
      fur: 'M65 109 C42 113 37 135 12 137 Q29 156 49 142 C65 131 66 119 65 109Z',
      tip: 'M12 137 Q28 138 36 129 L34 139 L43 136 L40 143 L49 142 Q29 156 12 137Z',
    },
    {
      fur: 'M60 103 C36 79 10 87 -6 110 Q12 105 27 120 C40 133 55 116 60 103Z',
      tip: 'M-6 110 Q8 88 26 91 L22 95 L30 99 L20 100 L27 105 L16 106 L21 112 Q8 105 -6 110Z',
    },
    {
      fur: 'M60 87 C35 58 9 73 5 36 C-12 63 -3 83 21 94 Q43 108 60 87Z',
      tip: 'M5 36 Q6 56 22 61 L12 61 L19 69 L9 66 L16 76 L7 73 L13 83 C-5 72 -8 57 5 36Z',
    },
    {
      fur: 'M59 70 C58 32 38 3 3 4 C26 23 15 45 27 64 Q39 81 59 70Z',
      tip: 'M3 4 C28 3 44 18 51 36 L43 30 L43 39 L35 29 L34 40 L26 34 L24 43 C20 26 19 17 3 4Z',
    },
  ]

  return (
    <svg viewBox="0 0 144 144" fill="none" aria-hidden="true">
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" x="-16" y="-24" width="176" height="192">
          <rect x="-16" y="-24" width="176" height="192" fill="white" />
          <circle cx="72" cy="72" r="49.5" fill="black" />
        </mask>
      </defs>
      <g mask={`url(#${maskId})`} strokeLinejoin="round">
        {pairs.map((tail, index) => (
          <g key={index}>
            {[false, true].map((mirrored) => (
              <g key={String(mirrored)} transform={mirrored ? 'translate(144 0) scale(-1 1)' : undefined}>
                <g className={styles.fox__tail} style={{ '--tail-delay': `${index * -0.6}s` }}>
                  <path d={tail.fur} fill="#fffaf7" />
                  <path d={tail.tip} fill="#ed171f" />
                  <path d={tail.fur} stroke="#403039" strokeWidth="1.5" />
                </g>
              </g>
            ))}
          </g>
        ))}
        <g className={styles.fox__tail} style={{ '--tail-delay': '-2.8s' }}>
          <path d="M58 46 C54 20 53 -4 87 -15 C72 6 82 23 86 43 Q74 56 58 46Z" fill="#fffaf7" />
          <path d="M87 -15 C73 -10 53 -1 56 23 L61 14 L65 22 L70 8 L75 18 L78 12 Q73 -1 87 -15Z" fill="#ed171f" />
          <path d="M58 46 C54 20 53 -4 87 -15 C72 6 82 23 86 43 Q74 56 58 46Z" stroke="#403039" strokeWidth="1.5" />
        </g>
      </g>
    </svg>
  )
}

export const DECORATION_ART = {
  'fluffy-kitten': FluffyKitten,
  'nine-tailed-fox': NineTailedFox,
  'top-hat': TopHat,
  'golden-dragon': GoldenDragon,
  'butterflies': Butterflies,
  'sakura': Sakura,
  'aurora': Aurora,
  'music': Music,
  'cat': Cat,
  'cyber': Cyber,
  'jellyfish': Jellyfish,
  'dragon': Dragon,

  ghost: Ghost,
  'solar-system': SolarSystem,
  snake: Snake,
  devil: Devil,
  sea: Sea,
  sun: Sun,
  coffee: Coffee,
  galaxy: Galaxy,
  halloween: Halloween,
  starlight: Starlight,
  bubbles: Bubbles,
  hearts: Hearts,
  'neon-ring': NeonRing,
  lightning: Lightning,
  rain: Rain,
  clouds: Clouds,
  snow: Snow,
  'soft-fire': SoftFire,
  halo: Halo,
  'angel-wings': AngelWings,
}
