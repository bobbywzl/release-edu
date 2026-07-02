'use client'
/**
 * Reward sound effects — synthesized with WebAudio (zero assets, instant).
 *
 * The palette copies what proven habit apps use:
 * - XP ding: a short bright two-note blip (Duolingo "correct" / iOS tri-tone
 *   family) — high frequency, fast decay, unmistakably positive.
 * - Level-up: an ascending major arpeggio with a shimmer tail (classic RPG
 *   level-up grammar — rising pitch = rising status).
 * - Badge unlock: a warm rolled major chord (trophy/achievement grammar,
 *   à la Xbox achievement).
 *
 * All sounds are < 0.8s, gain-enveloped (no clicks), and gated behind a
 * user-toggleable setting persisted in localStorage ('bob-sfx', default on).
 * Browsers only allow audio after a user gesture — XP events always follow
 * one (answering, sending), so autoplay policies are naturally satisfied.
 */

let ctx: AudioContext | null = null

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  try {
    if (!ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AC) return null
      ctx = new AC()
    }
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

export function sfxEnabled(): boolean {
  try { return localStorage.getItem('bob-sfx') !== '0' } catch { return true }
}

export function setSfxEnabled(on: boolean): void {
  try { localStorage.setItem('bob-sfx', on ? '1' : '0') } catch { /* noop */ }
}

/** One enveloped oscillator note. */
function note(
  c: AudioContext,
  freq: number,
  startAt: number,
  duration: number,
  opts: { type?: OscillatorType; peak?: number } = {},
) {
  const osc = c.createOscillator()
  const gain = c.createGain()
  osc.type = opts.type ?? 'sine'
  osc.frequency.setValueAtTime(freq, startAt)
  const peak = opts.peak ?? 0.12
  gain.gain.setValueAtTime(0.0001, startAt)
  gain.gain.exponentialRampToValueAtTime(peak, startAt + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration)
  osc.connect(gain).connect(c.destination)
  osc.start(startAt)
  osc.stop(startAt + duration + 0.05)
}

/** Small-step reward: bright two-note ding (E6 → B6). */
export function playXpDing(): void {
  if (!sfxEnabled()) return
  const c = getCtx()
  if (!c) return
  const t = c.currentTime
  note(c, 1318.5, t, 0.14, { peak: 0.1 })          // E6
  note(c, 1975.5, t + 0.09, 0.22, { peak: 0.09 })  // B6
}

/** Level-up: ascending C-major arpeggio + octave shimmer. */
export function playLevelUp(): void {
  if (!sfxEnabled()) return
  const c = getCtx()
  if (!c) return
  const t = c.currentTime
  const seq = [523.25, 659.25, 784.0, 1046.5] // C5 E5 G5 C6
  seq.forEach((f, i) => note(c, f, t + i * 0.09, 0.3, { type: 'triangle', peak: 0.12 }))
  // Shimmer tail — quiet octave sparkle over the final chord.
  note(c, 2093.0, t + 0.36, 0.5, { peak: 0.05 })
  note(c, 1568.0, t + 0.42, 0.45, { peak: 0.04 })
}

/** Badge unlock: warm rolled major chord (G4 B4 D5 G5). */
export function playBadgeUnlock(): void {
  if (!sfxEnabled()) return
  const c = getCtx()
  if (!c) return
  const t = c.currentTime
  const chord = [392.0, 493.88, 587.33, 784.0]
  chord.forEach((f, i) => note(c, f, t + i * 0.045, 0.6, { type: 'triangle', peak: 0.09 }))
}
