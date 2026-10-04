/**
 * @file lib/uiSounds.js
 * @description Short interface cues, synthesized on the spot: nothing to download or decode, and
 * silence wherever Web Audio is missing or the tab is in the background.
 */

// A rising blip: pitch glides from `from` to `to` Hz while the volume swells to `gain` and fades
const CUES = {
  send: { wave: 'sine', from: 520, to: 1040, durationMs: 110, gain: 0.06 },
}

const ATTACK_S = 0.012
const SILENT = 0.0001

let context = null

/** Plays a cue by name; call it from a click or key press, which is what lets audio start. */
export const playCue = (name) => {
  const cue = CUES[name]
  if (!cue || typeof window === 'undefined' || document.hidden) return
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext
    if (!AudioContextClass) return
    context ??= new AudioContextClass()
    if (context.state === 'suspended') context.resume().catch(() => {})

    const start = context.currentTime
    const end = start + cue.durationMs / 1000
    const oscillator = context.createOscillator()
    const volume = context.createGain()
    oscillator.type = cue.wave
    oscillator.frequency.setValueAtTime(cue.from, start)
    oscillator.frequency.exponentialRampToValueAtTime(cue.to, end)
    volume.gain.setValueAtTime(SILENT, start)
    volume.gain.exponentialRampToValueAtTime(cue.gain, start + ATTACK_S)
    volume.gain.exponentialRampToValueAtTime(SILENT, end)
    oscillator.connect(volume).connect(context.destination)
    oscillator.start(start)
    oscillator.stop(end)
  } catch {
    /* A cue is decoration: a browser that refuses it carries on in silence */
  }
}
