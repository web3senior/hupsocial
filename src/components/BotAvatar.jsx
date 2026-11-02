'use client'

import { useMemo } from 'react'
import { botAvatarDataUri, resolveBotTraits } from '@/lib/botAvatar'

/**
 * Hup's robot avatar (lib/botAvatar.js). `seed` picks a full look — an agent's address gives every
 * agent its own robot — and `traits` overrides any part of it.
 *
 *   <BotAvatar seed={agent.address} />
 *   <BotAvatar seed={agent.address} traits={{ color: 'mint', eyes: 'happy' }} size={96} />
 *   <BotAvatar seed={agent.address} sleeping />   // switched off or out of credits
 *
 * Decorative by default; pass `alt` where the robot is the only thing naming who it is.
 */
export default function BotAvatar({ seed = '', traits = null, size = 56, background = true, sleeping = false, alt = '', className }) {
  const src = useMemo(() => botAvatarDataUri(resolveBotTraits(seed, traits), { background, sleeping }), [seed, traits, background, sleeping])

  // eslint-disable-next-line @next/next/no-img-element -- an inline SVG data URI; next/image has nothing to optimize
  return <img className={className} src={src} width={size} height={size} alt={alt} aria-hidden={alt ? undefined : true} draggable={false} />
}
